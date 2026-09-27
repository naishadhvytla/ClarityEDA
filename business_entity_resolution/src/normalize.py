"""Vectorised text normalisation for business names and addresses.

All work is done with pandas string methods (Arrow-backed, so fast on 10M+ rows) plus
hand-written dictionaries embedded in this file; no external data is used.  The entry
point is :func:`normalize_frame`, which adds every derived view used for blocking keys
and pair features.
"""
from __future__ import annotations

import re
from typing import Dict

import numpy as np
import pandas as pd

# Devanagari -> Latin transliteration table (hand-written, approximate ITRANS-like).
DEVANAGARI = {
    "अ": "a", "आ": "a", "इ": "i", "ई": "i", "उ": "u", "ऊ": "u", "ऋ": "ri", "ए": "e", "ऐ": "ai", "ओ": "o",
    "औ": "au", "ऑ": "o", "क": "k", "ख": "kh", "ग": "g", "घ": "gh", "ङ": "n", "च": "ch", "छ": "chh", "ज": "j",
    "झ": "jh", "ञ": "n", "ट": "t", "ठ": "th", "ड": "d", "ढ": "dh", "ण": "n", "त": "t", "थ": "th", "द": "d",
    "ध": "dh", "न": "n", "प": "p", "फ": "ph", "ब": "b", "भ": "bh", "म": "m", "य": "y", "र": "r", "ल": "l",
    "व": "v", "श": "sh", "ष": "sh", "स": "s", "ह": "h", "ळ": "l", "क़": "k", "ख़": "kh", "ग़": "g", "ज़": "z",
    "ड़": "r", "ढ़": "rh", "फ़": "f", "य़": "y", "ा": "a", "ि": "i", "ी": "i", "ु": "u", "ू": "u", "ृ": "ri",
    "े": "e", "ै": "ai", "ो": "o", "ौ": "au", "ॉ": "o", "ं": "n", "ँ": "n", "ः": "h", "्": "", "़": "",
    "०": "0", "१": "1", "२": "2", "३": "3", "४": "4", "५": "5", "६": "6", "७": "7", "८": "8", "९": "9",
}
# Indic scripts (Bengali, Gurmukhi, Gujarati, Oriya, Tamil, Telugu, Kannada, Malayalam) share the
# ISCII-derived layout of Devanagari at fixed 0x80 offsets, so one table transliterates all of them.
_DEV_TABLE = str.maketrans({chr(ord(k) + off): v for k, v in DEVANAGARI.items() if len(k) == 1
                            for off in range(0, 0x500, 0x80)})
_DEV_RE = re.compile("[ऀ-෿]")

# Legal forms, articles and generic words dropped to form the "core" name (after canonicalisation).
LEGAL = ("pvt private ltd limited llc l l c inc incorporated corp corporation co company cos llp lp plc pllc pc "
         "gmbh sa sas sasu sarl eurl sci snc the of and et le la les de du des dba aka fka formerly "
         "com www net org in mr mrs ms dr sri shri smt messrs m s praivet praibhet praivhet prayvet pra li limitid limited")
_LEGAL_RE = r"\b(?:" + "|".join(sorted(set(LEGAL.split()), key=len, reverse=True)) + r")\b"

# Address abbreviations: long form -> canonical short form.
ADDR_MAP: Dict[str, str] = {
    "street": "st", "saint": "st", "road": "rd", "avenue": "ave", "av": "ave", "boulevard": "blvd", "bd": "blvd",
    "drive": "dr", "lane": "ln", "court": "ct", "place": "pl", "square": "sq", "highway": "hwy",
    "parkway": "pkwy", "terrace": "ter", "circle": "cir", "trail": "trl", "suite": "ste", "apartment": "apt",
    "building": "bldg", "floor": "fl", "north": "n", "south": "s", "east": "e", "west": "w", "number": "no",
    "nagar": "ngr", "near": "nr", "opposite": "opp", "sector": "sec", "colony": "col", "cross": "crs",
    "layout": "lyt", "phase": "ph", "block": "blk", "marg": "mrg", "market": "mkt", "extension": "extn",
    "industrial": "indl", "estate": "est", "society": "soc", "complex": "cmplx", "tower": "twr",
    "chemin": "ch", "impasse": "imp", "allee": "all", "faubourg": "fbg", "quai": "qu", "residence": "res",
    "bangalore": "bengaluru", "bombay": "mumbai", "madras": "chennai", "calcutta": "kolkata",
    "gurgaon": "gurugram", "poona": "pune", "baroda": "vadodara", "mysore": "mysuru", "cochin": "kochi",
    "trivandrum": "thiruvananthapuram", "allahabad": "prayagraj", "pondicherry": "puducherry",
}
_ADDR_RE = r"\b(?:" + "|".join(sorted(ADDR_MAP, key=len, reverse=True)) + r")\b"
# Words carrying no locating information (dropped from the address key words).
ADDR_STOP = ("st rd ave blvd dr ln ct pl sq hwy pkwy ter cir trl ste apt bldg fl n s e w no ngr nr opp sec col crs "
             "lyt ph blk mrg mkt extn indl est soc cmplx twr unit po box plot flat house door null none nan "
             "india usa us france rue ch imp all fbg qu res cedex h shop office room first second third ground "
             "floor gf ff sf main near opposite behind road street")


def _translit(s: pd.Series) -> pd.Series:
    """Transliterate Indic-script characters to Latin (only rows containing them are touched)."""
    mask = s.str.contains(_DEV_RE.pattern, regex=True)
    if mask.any():
        s = s.copy()
        s[mask] = [x.translate(_DEV_TABLE) for x in s[mask]]
    return s


def clean(s: pd.Series) -> pd.Series:
    """Lowercase, strip Latin accents, transliterate Indic scripts, unify ``&``/``+`` and keep [a-z0-9 ]."""
    s = _translit(s.fillna("").astype(str))
    s = s.str.normalize("NFKD").str.lower()
    s = s.str.replace(r"[̀-ͯ]", "", regex=True)
    s = s.str.replace(r"[&+]", " and ", regex=True).str.replace(r"['’`.]", "", regex=True)
    s = s.str.replace(r"[^a-z0-9]+", " ", regex=True)
    s = s.str.replace(r"(\d)(st|nd|rd|th|er|eme|e)\b", r"\1", regex=True)
    s = s.str.replace(r"(\d)([a-z])", r"\1 \2", regex=True).str.replace(r"([a-z])(\d)", r"\1 \2", regex=True)
    s = s.str.replace(r"\b0+(\d)", r"\1", regex=True)
    return s.str.replace(r"\s+", " ", regex=True).str.strip()


def core_name(clean_name: pd.Series) -> pd.Series:
    """Drop legal forms/articles and fix common abbreviations to get the distinctive core name."""
    s = clean_name.str.replace(r"\b(?:pvt|private) (?:ltd|limited)\b", " ", regex=True)
    s = s.str.replace(_LEGAL_RE, " ", regex=True)
    s = s.str.replace(r"\s+", " ", regex=True).str.strip()
    return s.where(s != "", clean_name)


def canon_address(clean_addr: pd.Series) -> pd.Series:
    """Map street / locality / city variants of an already-cleaned address to canonical forms."""
    s = clean_addr.str.replace(r"\b(\d{3}) (\d{3})\b", r"\1\2", regex=True)  # split PIN codes
    return s.str.replace(_ADDR_RE, lambda m: ADDR_MAP[m.group(0)], regex=True)


# Legal-form words and their canonical token; the sequence found in a name is kept as a
# separate view because look-alike distractors often differ only in legal form.
LEGAL_CANON = {"pvt": "pvt", "private": "pvt", "ltd": "ltd", "limited": "ltd", "public": "public", "llc": "llc",
               "inc": "inc", "incorporated": "inc", "corp": "corp", "corporation": "corp", "co": "co",
               "company": "co", "llp": "llp", "lp": "lp", "plc": "plc", "sarl": "sarl", "sas": "sas",
               "sa": "sa", "eurl": "eurl", "gmbh": "gmbh", "pllc": "pllc", "pc": "pc"}
_LEGAL_FIND = r"\b(?:" + "|".join(sorted(LEGAL_CANON, key=len, reverse=True)) + r")\b"


def legal_form(clean_name: pd.Series) -> pd.Series:
    """Canonical, de-duplicated, sorted legal-form tokens present in a cleaned name ("" if none)."""
    found = clean_name.str.findall(_LEGAL_FIND)
    return found.map(lambda xs: " ".join(sorted({LEGAL_CANON[x] for x in xs})) if len(xs) else "")


def normalize_frame(df: pd.DataFrame) -> pd.DataFrame:
    """Return ``df`` plus normalised views: ``name``, ``core``, ``legal``, ``compact``, ``tsort``, ``addr``,
    ``nums`` (address number tokens), ``awords`` (informative address words) and ``src``."""
    out = pd.DataFrame({"entity_id": df["entity_id"].values, "country": df["country"].values})
    out["nonascii"] = df["business_name"].map(lambda x: not x.isascii()).values.astype(np.float32)
    out["name"] = clean(df["business_name"]).values
    out["core"] = core_name(out["name"]).values
    out["legal"] = legal_form(out["name"]).values
    out["compact"] = out["core"].str.replace(" ", "", regex=False)
    out["tsort"] = out["core"].str.split(" ").map(lambda t: " ".join(sorted(t)))
    out["addr"] = canon_address(clean(df["business_address"])).values
    out["nums"] = out["addr"].str.findall(r"\b\d+\b").str.join(" ")
    stop = r"\b(?:" + "|".join(ADDR_STOP.split()) + r"|\d+\w*)\b"
    out["awords"] = out["addr"].str.replace(stop, " ", regex=True).str.replace(r"\s+", " ", regex=True).str.strip()
    out["src"] = out["entity_id"].str[:2]
    return out
