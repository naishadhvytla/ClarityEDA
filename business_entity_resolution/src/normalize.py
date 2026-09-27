"""Text normalisation for business names and addresses.

Every function here is pure string -> string (or string -> tuple) and relies only on
hand-written dictionaries embedded in this file (no external data).  The main entry
point is :func:`normalize_frame`, which adds every derived "view" used by blocking
and feature extraction to a records DataFrame.
"""
from __future__ import annotations

import re
import unicodedata
from typing import Dict, List, Tuple

import pandas as pd

# --------------------------------------------------------------------------------------
# Dictionaries (hand-written, language-agnostic where possible)
# --------------------------------------------------------------------------------------

# Multi-word phrases are rewritten before token mapping (longest first).
NAME_PHRASES: List[Tuple[str, str]] = [
    ("societe par actions simplifiee", "sas"),
    ("societe a responsabilite limitee", "sarl"),
    ("entreprise unipersonnelle a responsabilite limitee", "eurl"),
    ("societe en nom collectif", "snc"),
    ("societe civile immobiliere", "sci"),
    ("societe anonyme", "sa"),
    ("private limited", "pvt ltd"),
    ("public limited company", "plc"),
    ("limited liability company", "llc"),
    ("limited liability partnership", "llp"),
    ("limited partnership", "lp"),
    ("public limited", "ltd"),
    ("doing business as", "dba"),
    ("trading as", "dba"),
    ("t a", "dba"),
    ("d b a", "dba"),
    ("also known as", "aka"),
    ("a k a", "aka"),
    ("formerly known as", "fka"),
    ("f k a", "fka"),
]

NAME_TOKENS: Dict[str, str] = {
    "corporation": "corp", "corpn": "corp", "corp": "corp",
    "incorporated": "inc", "incorporation": "inc",
    "private": "pvt", "pvt": "pvt", "pte": "pvt", "prv": "pvt",
    "limited": "ltd", "ltd": "ltd", "ltda": "ltd", "lmtd": "ltd",
    "company": "co", "compagnie": "co", "cie": "co", "comp": "co", "cpy": "co",
    "international": "intl", "intl": "intl", "internationale": "intl",
    "services": "svc", "service": "svc", "svcs": "svc", "srvcs": "svc",
    "technologies": "tech", "technology": "tech", "technologie": "tech", "technologies.": "tech",
    "techno": "tech", "tech": "tech",
    "enterprises": "ent", "enterprise": "ent", "entreprise": "ent", "entreprises": "ent",
    "industries": "ind", "industry": "ind", "industrie": "ind", "inds": "ind",
    "brothers": "bros", "bro": "bros", "freres": "bros",
    "centre": "ctr", "center": "ctr", "cntr": "ctr",
    "et": "and", "und": "and", "n": "and",
    "associates": "assoc", "associate": "assoc", "associes": "assoc",
    "manufacturing": "mfg", "manufacturers": "mfg", "manufacturer": "mfg",
    "solutions": "soln", "solution": "soln",
    "systems": "sys", "system": "sys", "systemes": "sys",
    "trading": "trdg", "traders": "trdrs", "trader": "trdrs",
    "group": "grp", "groupe": "grp",
    "holdings": "hldg", "holding": "hldg",
    "management": "mgmt", "consulting": "consult", "consultants": "consult", "consultancy": "consult",
    "restaurant": "rest", "restaurants": "rest",
    "hospital": "hosp", "hospitals": "hosp",
    "pharmaceuticals": "pharma", "pharmaceutical": "pharma", "pharmacie": "pharma", "pharmacy": "pharma",
    "laboratories": "labs", "laboratory": "labs", "laboratoire": "labs", "laboratoires": "labs", "lab": "labs",
    "saint": "st", "sainte": "ste", "mount": "mt", "mountain": "mtn",
    "national": "natl", "general": "gen", "american": "amer", "america": "amer",
    "indian": "ind", "india": "ind", "bharat": "ind",
    "engineering": "engg", "engineers": "engg", "engg": "engg",
    "construction": "constr", "constructions": "constr",
    "department": "dept", "development": "dev", "developers": "dev",
    "incorporated.": "inc", "llc.": "llc", "l.l.c": "llc",
}

# Legal forms / articles removed to form the "core" name.
LEGAL_FORMS = {
    "inc", "corp", "co", "ltd", "pvt", "llc", "llp", "lp", "plc", "pllc", "pc", "gmbh", "ag", "bv", "nv",
    "sa", "sas", "sasu", "sarl", "eurl", "sci", "snc", "scs", "sca", "selarl", "opc", "the", "and", "of",
    "le", "la", "les", "l", "de", "du", "des", "d", "a", "an", "et", "dba", "aka", "fka",
}

ADDR_TOKENS: Dict[str, str] = {
    # English street types
    "street": "st", "str": "st", "st": "st", "road": "rd", "rd": "rd", "avenue": "ave", "av": "ave",
    "ave": "ave", "aven": "ave", "boulevard": "blvd", "blvd": "blvd", "bd": "blvd", "boul": "blvd",
    "drive": "dr", "dr": "dr", "lane": "ln", "ln": "ln", "court": "ct", "ct": "ct", "place": "pl",
    "pl": "pl", "square": "sq", "sq": "sq", "highway": "hwy", "hwy": "hwy", "parkway": "pkwy",
    "pkwy": "pkwy", "terrace": "ter", "circle": "cir", "trail": "trl", "way": "way", "suite": "ste",
    "ste": "ste", "apartment": "apt", "apt": "apt", "building": "bldg", "bldg": "bldg", "floor": "fl",
    "fl": "fl", "flr": "fl", "north": "n", "south": "s", "east": "e", "west": "w", "northeast": "ne",
    "northwest": "nw", "southeast": "se", "southwest": "sw", "unit": "unit", "room": "rm", "number": "no",
    "num": "no", "no": "no", "nos": "no", "plot": "plot", "po": "po", "box": "box", "mount": "mt",
    "fort": "ft", "saint": "st", "expressway": "expy", "freeway": "fwy", "route": "rte", "rte": "rte",
    # Indian address terms
    "nagar": "ngr", "ngr": "ngr", "near": "nr", "nr": "nr", "opposite": "opp", "opp": "opp",
    "behind": "bhd", "beside": "bsd", "sector": "sec", "sec": "sec", "colony": "col", "col": "col",
    "cross": "crs", "crs": "crs", "layout": "lyt", "phase": "ph", "ph": "ph", "block": "blk",
    "blk": "blk", "marg": "mrg", "mrg": "mrg", "chowk": "chk", "bazaar": "bzr", "bazar": "bzr",
    "market": "mkt", "mkt": "mkt", "main": "main", "mn": "main", "extension": "extn", "extn": "extn",
    "ext": "extn", "industrial": "indl", "indl": "indl", "estate": "est", "est": "est", "area": "area",
    "puram": "pm", "pur": "pur", "gali": "gali", "galli": "gali", "mohalla": "mohalla",
    "village": "vill", "vill": "vill", "vpo": "vill", "post": "post", "district": "dist", "dist": "dist",
    "taluk": "tq", "taluka": "tq", "tehsil": "tq", "tq": "tq", "stage": "stg", "stg": "stg",
    "apartments": "apt", "complex": "cmplx", "cmplx": "cmplx", "tower": "twr", "towers": "twr",
    "twr": "twr", "society": "soc", "soc": "soc", "housing": "hsg", "hsg": "hsg",
    "junction": "jn", "jn": "jn", "jnct": "jn", "station": "stn", "stn": "stn", "garden": "gdn",
    "gardens": "gdn", "park": "pk", "pk": "pk",
    # French address terms
    "rue": "rue", "r": "rue", "avenu": "ave", "chemin": "ch", "che": "ch", "chem": "ch", "ch": "ch",
    "impasse": "imp", "imp": "imp", "allee": "all", "all": "all", "faubourg": "fbg", "fbg": "fbg",
    "quai": "qu", "qu": "qu", "cours": "crs", "route": "rte", "rte": "rte", "place": "pl",
    "bis": "bis", "ter": "ter", "zone": "zone", "za": "za", "zi": "zi", "zac": "zac",
    "residence": "res", "res": "res", "batiment": "bldg", "bat": "bldg", "etage": "fl",
    "lieu": "lieu", "dit": "dit", "lotissement": "lot", "lot": "lot", "hameau": "ham",
    "passage": "pass", "square": "sq", "promenade": "prom", "esplanade": "espl",
}

# Words dropped from addresses entirely (country names, "cedex").
ADDR_DROP = {"usa", "us", "united", "states", "of", "america", "india", "bharat", "france",
             "cedex", "the", "and", "de", "du", "des", "la", "le", "les", "l", "d"}

US_STATES = {
    "alabama": "al", "alaska": "ak", "arizona": "az", "arkansas": "ar", "california": "ca",
    "colorado": "co", "connecticut": "ct", "delaware": "de", "florida": "fl", "georgia": "ga",
    "hawaii": "hi", "idaho": "id", "illinois": "il", "indiana": "in", "iowa": "ia", "kansas": "ks",
    "kentucky": "ky", "louisiana": "la", "maine": "me", "maryland": "md", "massachusetts": "ma",
    "michigan": "mi", "minnesota": "mn", "mississippi": "ms", "missouri": "mo", "montana": "mt",
    "nebraska": "ne", "nevada": "nv", "new hampshire": "nh", "new jersey": "nj", "new mexico": "nm",
    "new york": "ny", "north carolina": "nc", "north dakota": "nd", "ohio": "oh", "oklahoma": "ok",
    "oregon": "or", "pennsylvania": "pa", "rhode island": "ri", "south carolina": "sc",
    "south dakota": "sd", "tennessee": "tn", "texas": "tx", "utah": "ut", "vermont": "vt",
    "virginia": "va", "washington": "wa", "west virginia": "wv", "wisconsin": "wi", "wyoming": "wy",
    "district of columbia": "dc",
}
IN_STATES = {
    "andhra pradesh": "ap", "arunachal pradesh": "ar", "assam": "as", "bihar": "br",
    "chhattisgarh": "cg", "chattisgarh": "cg", "goa": "ga", "gujarat": "gj", "gujrat": "gj",
    "haryana": "hr", "himachal pradesh": "hp", "jharkhand": "jh", "karnataka": "ka", "kerala": "kl",
    "madhya pradesh": "mp", "maharashtra": "mh", "maharastra": "mh", "manipur": "mn",
    "meghalaya": "ml", "mizoram": "mz", "nagaland": "nl", "odisha": "od", "orissa": "od",
    "punjab": "pb", "rajasthan": "rj", "sikkim": "sk", "tamil nadu": "tn", "tamilnadu": "tn",
    "telangana": "ts", "tripura": "tr", "uttar pradesh": "up", "uttarakhand": "uk",
    "uttaranchal": "uk", "west bengal": "wb", "delhi": "dl", "new delhi": "dl",
    "jammu and kashmir": "jk", "jammu kashmir": "jk", "puducherry": "py", "pondicherry": "py",
    "chandigarh": "ch", "ladakh": "la",
}
CITY_ALIASES = {
    "bangalore": "bengaluru", "bengalooru": "bengaluru", "bombay": "mumbai", "madras": "chennai",
    "calcutta": "kolkata", "gurgaon": "gurugram", "poona": "pune", "baroda": "vadodara",
    "trivandrum": "thiruvananthapuram", "cochin": "kochi", "mysore": "mysuru", "benares": "varanasi",
    "banaras": "varanasi", "cawnpore": "kanpur", "simla": "shimla", "mangalore": "mangaluru",
    "belgaum": "belagavi", "hubli": "hubballi", "allahabad": "prayagraj", "vizag": "visakhapatnam",
    "calicut": "kozhikode", "pondicherry": "puducherry", "nyc": "new york", "la": "la",
}

_PHRASE_RES = [(re.compile(r"\b" + re.escape(p) + r"\b"), r) for p, r in NAME_PHRASES]
_STATE_RES = [(re.compile(r"\b" + re.escape(k) + r"\b"), v)
              for k, v in sorted({**US_STATES, **IN_STATES}.items(), key=lambda kv: -len(kv[0]))
              if " " in k]
_STATE_SINGLE = {k: v for k, v in {**US_STATES, **IN_STATES}.items() if " " not in k}
_DBA_SPLIT = re.compile(r"\b(?:dba|aka|fka)\b")
_ORDINAL = re.compile(r"\b(\d+)\s*(?:st|nd|rd|th|er|ere|eme|e|ieme)\b")
_DIGIT_ALPHA = re.compile(r"(?<=\d)(?=[a-z])|(?<=[a-z])(?=\d)")
_DOTTED = re.compile(r"\b(?:[a-z]\.){2,}[a-z]?\.?")
_NON_ALNUM = re.compile(r"[^a-z0-9 ]+")
_SPACES = re.compile(r"\s+")
_PIN_SPLIT = re.compile(r"\b(\d{3})\s+(\d{3})\b")
_PHONETIC_RULES = [("ksh", "x"), ("sch", "s"), ("sh", "s"), ("ph", "f"), ("th", "t"), ("dh", "d"),
                   ("bh", "b"), ("kh", "k"), ("gh", "g"), ("ch", "c"), ("ck", "k"), ("q", "k"),
                   ("w", "v"), ("z", "s"), ("y", "i"), ("ee", "i"), ("oo", "u"), ("aa", "a"),
                   ("ou", "u"), ("c", "k")]
_REPEAT = re.compile(r"(.)\1+")


def basic_clean(text: str) -> str:
    """Lowercase, strip accents, unify symbols and punctuation into single-spaced tokens.

    Handles: NFKD accent stripping, apostrophes, ``&``/``+`` -> "and", dotted acronyms
    (``p.v.t`` -> ``pvt``), ordinals (``1st``/``2eme`` -> ``1``/``2``) and splitting of
    digit-letter boundaries (``12b`` -> ``12 b``).
    """
    if not text:
        return ""
    t = unicodedata.normalize("NFKD", str(text))
    t = "".join(ch for ch in t if not unicodedata.combining(ch)).lower()
    t = t.replace("’", "'").replace("`", "'").replace("'", "")
    t = t.replace("&", " and ").replace("+", " and ").replace("@", " at ")
    t = _DOTTED.sub(lambda m: m.group(0).replace(".", ""), t)
    t = _NON_ALNUM.sub(" ", t)
    t = _ORDINAL.sub(r"\1", t)
    t = _DIGIT_ALPHA.sub(" ", t)
    return _SPACES.sub(" ", t).strip()


def canonical_name(text: str) -> str:
    """Return the cleaned name with multi-word legal phrases and tokens mapped to canonical forms."""
    t = basic_clean(text)
    for rx, rep in _PHRASE_RES:
        t = rx.sub(rep, t)
    return " ".join(NAME_TOKENS.get(tok, tok) for tok in t.split())


def split_dba(canon: str) -> Tuple[str, str]:
    """Split a canonical name on DBA/AKA/FKA markers into (main part, alternate part)."""
    parts = [p.strip() for p in _DBA_SPLIT.split(canon) if p.strip()]
    if len(parts) <= 1:
        return (parts[0] if parts else canon), ""
    return parts[0], " ".join(parts[1:])


def core_name(canon: str) -> str:
    """Drop legal forms and articles; fall back to the canonical name if nothing is left."""
    toks = [t for t in canon.split() if t not in LEGAL_FORMS]
    return " ".join(toks) if toks else canon


def initials(core: str) -> str:
    """Initial letters of the core-name tokens (``tata consultancy svc`` -> ``tcs``)."""
    return "".join(t[0] for t in core.split() if t and not t.isdigit())


def phonetic_key(text: str) -> str:
    """Fold common transliteration variants so e.g. ``lakshmi``/``laxmi`` share a key."""
    out = []
    for tok in text.split():
        if tok.isdigit():
            out.append(tok)
            continue
        for a, b in _PHONETIC_RULES:
            tok = tok.replace(a, b)
        tok = _REPEAT.sub(r"\1", tok)
        if len(tok) > 1:
            tok = tok[0] + tok[1:].rstrip("aeiuh") if len(tok) > 3 else tok
        out.append(tok)
    return " ".join(out)


def canonical_address(text: str) -> str:
    """Clean an address: street/locality abbreviations, states -> codes, city aliases, joined PINs."""
    t = basic_clean(text)
    t = _PIN_SPLIT.sub(r"\1\2", t)
    for rx, code in _STATE_RES:
        t = rx.sub(code, t)
    toks = []
    for tok in t.split():
        if tok in ADDR_DROP:
            continue
        tok = CITY_ALIASES.get(tok, tok)
        tok = _STATE_SINGLE.get(tok, tok)
        toks.append(ADDR_TOKENS.get(tok, tok))
    return " ".join(toks)


def address_numbers(addr: str) -> Tuple[str, str, str]:
    """Extract (all numbers space-joined, postal-like 5-6 digit code, house number) from an address."""
    nums = [t for t in addr.split() if t.isdigit()]
    postal = ""
    for n in reversed(nums):
        if 5 <= len(n) <= 6:
            postal = n
            break
    house = ""
    for n in nums:
        if n != postal and len(n) <= 5:
            house = n
            break
    return " ".join(nums), postal, house


def _map_unique(series: pd.Series, fn) -> pd.Series:
    """Apply ``fn`` once per unique value of ``series`` (much faster on repetitive columns)."""
    uniq = series.unique()
    lookup = {u: fn(u) for u in uniq}
    return series.map(lookup)


def normalize_frame(df: pd.DataFrame) -> pd.DataFrame:
    """Add every normalised view (names, core, compact, initials, phonetic, address, numbers).

    The input must have ``business_name`` and ``business_address`` columns.  A copy with
    extra string columns is returned; no rows are added or removed.
    """
    out = df.copy()
    out["name_canon"] = _map_unique(out["business_name"], canonical_name)
    parts = _map_unique(out["name_canon"], split_dba)
    out["name_main"] = parts.str[0]
    out["name_alt"] = parts.str[1]
    out["core"] = _map_unique(out["name_main"], core_name)
    out["core_alt"] = _map_unique(out["name_alt"], lambda s: core_name(s) if s else "")
    out["core_full"] = (out["core"] + " " + out["core_alt"]).str.strip()
    out["compact"] = out["core"].str.replace(" ", "", regex=False)
    out["initials"] = _map_unique(out["core"], initials)
    out["phon"] = _map_unique(out["core_full"], phonetic_key)
    out["addr"] = _map_unique(out["business_address"], canonical_address)
    nums = _map_unique(out["addr"], address_numbers)
    out["addr_nums"] = nums.str[0]
    out["postal"] = nums.str[1]
    out["house"] = nums.str[2]
    out["addr_words"] = _map_unique(out["addr"], lambda s: " ".join(t for t in s.split() if not t.isdigit()))
    out["combo"] = (out["core_full"] + " | " + out["addr"]).str.strip()
    return out
