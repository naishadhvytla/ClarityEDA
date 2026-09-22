/* ==========================================================================
   Clarity — semantic layer
   Works out what each column *means* (money, count, category, date, outcome,
   identifier…), what kind of dataset it is, and how its values should be
   formatted and aggregated. Pure functions, no DOM.
   ========================================================================== */
import { MONTH_NAMES } from './data.js';

/* ---------- vocabulary ---------- */
const W = s => new Set(s.split(' '));
const ID_LAST = W('id ids uuid guid key no num nbr number sku roll reg regno rollno serial sno sl srno ref reference code');
const MONEY = W('revenue sales amount amt price cost costs profit income salary salaries fee fees spend spent spending payment payments paid gmv budget expense expenses charges charge balance mrp wage wages ctc package fare fares rent earnings turnover bill billing tax premium value worth loss funding donation');
const MONEY_SUM = W('revenue sales amount amt profit spend spent spending payment payments paid gmv expense expenses turnover earnings bill billing tax loss funding donation costs');
const CURRENCY_TOKENS = { inr: '₹', rs: '₹', rupee: '₹', rupees: '₹', usd: '$', dollar: '$', dollars: '$', eur: '€', euro: '€', euros: '€', gbp: '£', pound: '£', pounds: '£' };
const COUNT = W('units unit quantity qty count counts orders items tickets visits clicks impressions views sessions calls downloads leads stock inventory volume backlogs backlog children dependents rooms bedrooms bathrooms members attempts purchases transactions followers likes shares comments installs signups users customers students employees products absences absent late');
const COUNT_SUM = W('units quantity qty orders items clicks impressions views visits sessions calls downloads leads volume purchases transactions installs signups likes shares comments');
const PERCENT = W('pct percent percentage rate ratio share attendance ctr margin utilization utilisation occupancy');
const SCORE = W('score scores marks mark gpa cgpa sgpa rating ratings points satisfaction performance grade grades result nps');
const DURATION = W('tenure duration days months years hours hrs minutes mins seconds secs weeks experience exp period delay lead');
const AGE = W('age');
const ORDINAL_DIM = W('semester sem year yr level class pclass tier floor quarter qtr month week weekday day standard std batch stage phase size generation division');
const GEO = W('city state country region zone district location province territory continent town village locality area pincode pin zip postal postcode market branchcity');
const PERSON = W('name names customer client student employee patient user member person author owner manager agent seller buyer vendor supplier doctor teacher faculty candidate applicant');
const TEXT_HINT = W('comment comments description desc review reviews feedback notes note remarks remark text message summary title address');
const TARGET = W('churn churned attrition attrited left exited exit converted conversion convert default defaulted fraud fraudulent survived survival outcome target label result passed pass placed placement approved approval response purchased clicked subscribed cancelled canceled returned readmitted diabetes disease stroke heartdisease won hired selected dropout dropped');
const POS_VALUES = W('yes y true t 1 churned churn left exited attrited converted default defaulted fraud fraudulent survived pass passed placed approved won success successful purchased subscribed returned cancelled canceled positive present hired selected dropout readmitted');
const NEG_VALUES = W('no n false f 0 stayed retained active notchurned fail failed notplaced unplaced rejected declined lost failure negative absent legit legitimate genuine normal notconverted repaid paid current');
const LATLON = W('lat latitude lng lon long longitude');

/* ---------- names ---------- */
export function tokens(name) {
  return String(name)
    .replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase().split(/[^a-z0-9%]+/).filter(Boolean);
}
const ACRONYMS = { id: 'ID', cgpa: 'CGPA', sgpa: 'SGPA', gpa: 'GPA', bmi: 'BMI', ctr: 'CTR', sku: 'SKU', emi: 'EMI', url: 'URL', upi: 'UPI', kpi: 'KPI', hr: 'HR', ai: 'AI', ds: 'DS', nps: 'NPS', mrp: 'MRP', ctc: 'CTC', gmv: 'GMV', usd: 'USD', inr: 'INR', gst: 'GST', pan: 'PAN', dob: 'DOB', cse: 'CSE', ece: 'ECE', eee: 'EEE', it: 'IT', bp: 'BP', sno: 'S.No' };

const UNIT_SUFFIX = { months: 'months', month: 'months', days: 'days', day: 'days', years: 'years', yrs: 'years', hours: 'hours', hrs: 'hours', minutes: 'min', mins: 'min', seconds: 'sec', secs: 'sec', weeks: 'weeks', kg: 'kg', kgs: 'kg', g: 'g', gm: 'g', km: 'km', cm: 'cm', mm: 'mm', gb: 'GB', mb: 'MB', sqft: 'sq ft', pct: '%', percent: '%', percentage: '%' };

export function prettyLabel(name) {
  const raw = String(name).trim();
  if (!raw) return 'Unnamed';
  const toks = raw.replace(/([a-z])([A-Z])/g, '$1 $2').split(/[\s_\-.]+/).filter(Boolean);
  const out = [];
  let unit = '';
  toks.forEach((t, i) => {
    const l = t.toLowerCase();
    if (CURRENCY_TOKENS[l] && toks.length > 1) return;
    if (UNIT_SUFFIX[l] && toks.length > 1 && i === toks.length - 1 && !/(ing|ed)$/i.test(toks[i - 1])) { unit = UNIT_SUFFIX[l]; return; }
    if (ACRONYMS[l]) { out.push(ACRONYMS[l]); return; }
    if (/^[A-Z0-9&]{2,5}$/.test(t)) { out.push(t); return; }
    out.push(i === 0 ? l.charAt(0).toUpperCase() + l.slice(1) : l);
  });
  let s = out.join(' ');
  if (!s) s = raw;
  s = s.charAt(0).toUpperCase() + s.slice(1);
  return unit ? `${s} (${unit})` : s;
}
/** Label without a trailing "(unit)" — for use inside sentences. */
export const shortLabel = label => String(label).replace(/\s*\([^)]*\)$/, '');

const IRREGULAR = { person: 'people', child: 'children', emp: 'employees', cust: 'customers', txn: 'transactions', trans: 'transactions', stu: 'students', pt: 'patients', prod: 'products', acct: 'accounts', acc: 'accounts', inv: 'invoices', ord: 'orders', user: 'users', staff: 'staff', data: 'records' };
export function plural(word) {
  const w = word.toLowerCase();
  if (IRREGULAR[w]) return IRREGULAR[w];
  if (/[^aeiou]y$/.test(w)) return w.slice(0, -1) + 'ies';
  if (/(ss|us|x|ch|sh)$/.test(w)) return w + 'es';
  if (/s$/.test(w)) return w;
  return w + 's';
}
export function singular(noun) {
  const map = { people: 'person', children: 'child', staff: 'staff member', records: 'record', data: 'record' };
  if (map[noun]) return map[noun];
  if (/ies$/.test(noun)) return noun.slice(0, -3) + 'y';
  if (/(ches|shes|xes|sses)$/.test(noun)) return noun.slice(0, -2);
  if (/s$/.test(noun)) return noun.slice(0, -1);
  return noun;
}

/* ---------- domains ---------- */
const DOMAINS = [
  { key: 'sales', label: 'Sales & orders', phrase: 'sales data', noun: 'orders', words: W('order orders invoice product products sku category categories revenue sales price quantity qty units discount store shipping ship cart profit mrp brand payment') },
  { key: 'customers', label: 'Customers & subscriptions', phrase: 'customer data', noun: 'customers', words: W('churn churned subscription plan contract tenure monthly charges internet service support tickets customer renewal') },
  { key: 'hr', label: 'People & HR', phrase: 'HR data', noun: 'employees', words: W('employee emp salary department dept designation job attrition hire hired experience performance manager overtime satisfaction promotion leave') },
  { key: 'education', label: 'Education & students', phrase: 'student data', noun: 'students', words: W('student students roll marks mark grade cgpa sgpa gpa attendance course subject semester sem branch section exam score faculty study backlogs placement internal external') },
  { key: 'finance', label: 'Finance & banking', phrase: 'financial data', noun: 'transactions', words: W('account balance transaction transactions loan credit debit interest emi bank income fraud default merchant card') },
  { key: 'health', label: 'Healthcare', phrase: 'healthcare data', noun: 'patients', words: W('patient diagnosis bmi blood glucose cholesterol heart disease hospital doctor bp insulin smoker diabetes stroke admission') },
  { key: 'marketing', label: 'Marketing & campaigns', phrase: 'marketing data', noun: 'records', words: W('campaign clicks impressions ctr cpc cpm conversion conversions channel spend leads ad ads source medium utm reach engagement') },
  { key: 'realestate', label: 'Real estate', phrase: 'property data', noun: 'properties', words: W('bedrooms bathrooms sqft area rent property house lot built furnishing locality bhk') },
];

/* ---------- helpers ---------- */
const hasAny = (toks, set) => toks.some(t => set.has(t));
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
const URL_RE = /^https?:\/\//i;

function isSequential(nums) {
  let inc = 0, tot = 0;
  for (let i = 1; i < nums.length && i < 5000; i++) { if (!Number.isFinite(nums[i]) || !Number.isFinite(nums[i - 1])) continue; tot++; if (nums[i] > nums[i - 1]) inc++; }
  return tot > 10 && inc / tot > 0.95;
}

function targetInfo(col, toks) {
  if (col.unique !== 2 || !col.top || col.top.length !== 2) return null;
  const vals = col.top.map(([v]) => String(v).trim());
  const norm = vals.map(v => v.toLowerCase().replace(/[\s_-]+/g, ''));
  let posIdx = norm.findIndex(v => POS_VALUES.has(v));
  const negIdx = norm.findIndex(v => NEG_VALUES.has(v));
  const named = hasAny(toks, TARGET);
  const outcomeValues = norm.some(v => /^(pass|passed|fail|failed|placed|notplaced|churned|converted|approved|rejected|survived|defaulted|fraud|hired)$/.test(v));
  if (!named && !outcomeValues) return null;
  if (posIdx < 0 && negIdx >= 0) posIdx = 1 - negIdx;
  if (posIdx < 0) return null;
  if (negIdx === posIdx) return null;
  const positive = vals[posIdx], negative = vals[1 - posIdx];
  return { positive, negative, ...rateWording(toks, positive, negative) };
}

function rateWording(toks, pos, neg) {
  const t = new Set(toks), p = pos.toLowerCase();
  const pick = (rate, yes, no, good = false) => ({ rateLabel: rate, posLabel: yes, negLabel: no, good });
  if (t.has('churn') || t.has('churned')) return pick('Churn rate', 'churned', 'stayed');
  if (t.has('attrition') || t.has('attrited')) return pick('Attrition rate', 'left', 'stayed');
  if (t.has('left') || t.has('exited') || t.has('exit')) return pick('Exit rate', 'left', 'stayed');
  if (t.has('converted') || t.has('conversion') || t.has('convert')) return pick('Conversion rate', 'converted', 'did not convert', true);
  if (t.has('default') || t.has('defaulted')) return pick('Default rate', 'defaulted', 'did not default');
  if (t.has('fraud') || t.has('fraudulent')) return pick('Fraud rate', 'were fraudulent', 'were legitimate');
  if (t.has('survived') || t.has('survival')) return pick('Survival rate', 'survived', 'did not survive', true);
  if (t.has('placed') || t.has('placement')) return pick('Placement rate', 'were placed', 'were not placed', true);
  if (t.has('approved') || t.has('approval')) return pick('Approval rate', 'were approved', 'were not approved', true);
  if (t.has('hired')) return pick('Hiring rate', 'were hired', 'were not hired', true);
  if (t.has('dropout') || t.has('dropped')) return pick('Dropout rate', 'dropped out', 'continued');
  if (/^pass/.test(p)) return pick('Pass rate', 'passed', 'failed', true);
  if (/^fail/.test(p)) return pick('Fail rate', 'failed', 'passed');
  if (t.has('purchased')) return pick('Purchase rate', 'purchased', 'did not purchase', true);
  if (t.has('clicked')) return pick('Click rate', 'clicked', 'did not click', true);
  if (t.has('subscribed')) return pick('Subscription rate', 'subscribed', 'did not subscribe', true);
  if (t.has('cancelled') || t.has('canceled')) return pick('Cancellation rate', 'cancelled', 'did not cancel');
  if (t.has('returned')) return pick('Return rate', 'were returned', 'were kept');
  if (t.has('readmitted')) return pick('Readmission rate', 'were readmitted', 'were not readmitted');
  return pick(`“${pos}” rate`, `are “${pos}”`, `are “${neg}”`, null);
}

/* ---------- column understanding ---------- */
function classify(col, ds, N) {
  const toks = tokens(col.name);
  const last = toks[toks.length - 1] || '';
  const first = toks[0] || '';
  const label = prettyLabel(col.name);
  const meta = { name: col.name, label, short: shortLabel(label), tokens: toks, role: 'dimension', sub: null, agg: 'mean', unit: 'number', currency: null, decimals: 0, reason: '' };
  const done = (role, why, extra = {}) => Object.assign(meta, { role, reason: why }, extra);

  if (col.empty) return done('ignore', 'Column is empty');
  if (col.constant) return done('ignore', 'Every row has the same value');
  if (hasAny(toks, LATLON) && col.type === 'numeric') return done('ignore', 'Map coordinate', { sub: 'coord' });

  // contact details
  const topVals = (col.top || []).slice(0, 20).map(([v]) => String(v));
  if (col.type !== 'numeric' && topVals.length && topVals.filter(v => EMAIL_RE.test(v)).length / topVals.length > 0.8) return done('contact', 'Values look like email addresses', { sub: 'email' });
  if (topVals.length && topVals.filter(v => URL_RE.test(v)).length / topVals.length > 0.8) return done('contact', 'Values look like web links', { sub: 'url' });
  if (hasAny(toks, W('phone mobile cell whatsapp telephone tel contact')) && topVals.length && topVals.filter(v => /^[+\d][\d\s\-().]{6,}$/.test(v)).length / topVals.length > 0.7) return done('contact', 'Values look like phone numbers', { sub: 'phone' });

  // outcomes / two-valued columns (checked before identifiers)
  if (col.type === 'boolean' || (col.type === 'categorical' && col.unique === 2)) {
    const t = targetInfo(col, toks);
    if (t) return done('target', `Two-valued outcome (${t.positive} / ${t.negative})`, { sub: 'binary', ...t });
    return done('dimension', 'Yes/no style category', { sub: 'binary' });
  }

  // identifiers
  const idNamed = ID_LAST.has(last) || first === 'id' || /^(s\.?\s?no|sr\.?\s?no|sl\.?\s?no|#|index|unnamed:?\s*\d*)$/i.test(col.name.trim());
  const notMoneyName = !hasAny(toks, MONEY) && !hasAny(toks, SCORE) && !hasAny(toks, COUNT);
  if (idNamed && notMoneyName) {
    if (col.unique <= 30 && N >= col.unique * 5 && !['sno', 'index', 'serial'].includes(last)) return done('dimension', `“${last}” column with only ${col.unique} distinct values, used as a category`, { sub: 'code' });
    return done('id', `Name ends in “${last || 'id'}” — an identifier, not something to add up`);
  }
  if (col.type === 'numeric' && col.stats && col.stats.integer && col.uniqueRatio > 0.98 && N >= 20 && isSequential(ds.num(col.name)) && notMoneyName)
    return done('id', 'Unique, steadily increasing numbers — a row number or identifier');
  if ((col.type === 'categorical') && col.uniqueRatio > 0.95 && N >= 20 && col.avgLen <= 24) {
    const withDigits = topVals.filter(v => /\d/.test(v)).length / Math.max(1, topVals.length);
    if (withDigits > 0.7 && !hasAny(toks, PERSON)) return done('id', 'Every value is a unique code');
  }

  if (col.type === 'text') {
    if (hasAny(toks, PERSON) && col.avgLen < 60 && !hasAny(toks, TEXT_HINT)) return done('entity', 'Individual names — used for rankings', { sub: 'person' });
    return done('text', 'Long free-text values');
  }
  if (col.type === 'date') {
    const d = col.dates;
    return done('date', `Values are dates${d ? '' : ''}`, { sub: d && d.hasTime ? 'datetime' : 'date' });
  }


  if (col.type === 'numeric') {
    const st = col.stats;
    // year-like numbers act as a time dimension
    if ((toks.includes('year') || toks.includes('yr')) && st && st.integer && st.min >= 1900 && st.max <= 2100) return done('dimension', 'Calendar years — used as an ordered category', { sub: 'year' });
    const measureNamed = (hasAny(toks, MONEY) && !(toks.includes('balance') && hasAny(toks, W('life work')))) || hasAny(toks, COUNT) || hasAny(toks, SCORE) || hasAny(toks, PERCENT) || hasAny(toks, DURATION) || hasAny(toks, AGE) || Object.keys(CURRENCY_TOKENS).some(k => toks.includes(k));
    if (!measureNamed && st && st.integer && col.unique <= 6 && col.unique >= 2) return done('dimension', `Only ${col.unique} whole-number levels — treated as an ordered category`, { sub: 'ordinal' });
    if (hasAny(toks, ORDINAL_DIM) && !measureNamed && st && st.integer && col.unique <= 24) return done('dimension', 'Ordered levels (e.g. semester, tier)', { sub: 'ordinal' });
    // measures
    let unit = 'number', agg = 'mean', why = 'Numeric values';
    const curTok = toks.find(t => CURRENCY_TOKENS[t]);
    const payRate = toks.includes('rate') && hasAny(toks, W('hourly daily weekly monthly annual yearly pay wage'));
    const physical = hasAny(toks, W('mm cm m km kg g gm lbs lb inch inches ft length width height depth weight mass'));
    const moneyNamed = (hasAny(toks, MONEY) && !physical && !(toks.includes('balance') && hasAny(toks, W('life work')))) || payRate;
    if (hasAny(toks, W('pct percent percentage')) && st && st.min >= 0 && st.max <= 100) {
      unit = 'percent'; why = 'Percentage';
    } else if (hasAny(toks, W('discount')) && st && st.min >= 0 && st.max <= 1) {
      unit = 'percent'; why = 'Discount rate between 0 and 1'; meta.fraction = true;
    } else if (moneyNamed || curTok || col.currency) {
      unit = 'currency';
      agg = hasAny(toks, MONEY_SUM) || (toks.includes('total') && !hasAny(toks, SCORE)) ? 'sum' : 'mean';
      why = agg === 'sum' ? 'Money amount — totals are meaningful' : 'Money value per record (price, fee, salary) — averages are meaningful';
    } else if (col.percent || (hasAny(toks, PERCENT) && st && st.min >= 0 && st.max <= 100)) {
      unit = 'percent'; why = 'Percentage';
    } else if (hasAny(toks, SCORE)) { unit = 'score'; why = 'Score or marks — averages are meaningful';
    } else if (hasAny(toks, AGE)) { unit = 'age'; why = 'Age';
    } else if (hasAny(toks, DURATION)) { unit = 'duration'; why = 'Duration';
    } else if (hasAny(toks, COUNT)) { unit = 'count'; agg = hasAny(toks, COUNT_SUM) ? 'sum' : 'mean'; why = agg === 'sum' ? 'Count — totals are meaningful' : 'Count per record';
    } else if (hasAny(toks, PERCENT) && st && st.min >= 0 && st.max <= 1) { unit = 'percent'; why = 'Rate between 0 and 1'; meta.fraction = true; }
    if (toks.includes('total') && (unit === 'currency' || unit === 'count' || unit === 'number')) agg = 'sum';
    if (st && st.negatives > 0 && agg === 'sum' && unit !== 'currency') agg = 'mean';
    const currency = col.currency || (curTok ? CURRENCY_TOKENS[curTok] : null);
    const decimals = st ? (st.integer ? 0 : decimalsOf(ds.num(col.name))) : 0;
    return done('measure', why, { unit, agg, currency, decimals, sub: unit });
  }

  // categorical
  if (hasAny(toks, TEXT_HINT) && col.avgLen > 20) return done('text', 'Descriptive text');
  const geo = hasAny(toks, GEO);
  if (hasAny(toks, PERSON) && col.uniqueRatio > 0.3 && col.unique > 30) return done('entity', 'Individual names — used for rankings', { sub: 'person' });
  if (col.unique > 60 && col.uniqueRatio > 0.5) return done('entity', 'Mostly unique labels — used for top-N rankings', { sub: 'label' });
  if (col.unique > 60) return done('dimension', `Category with many values (${col.unique}); the top ones are shown`, { sub: geo ? 'geo' : 'highcard' });
  return done('dimension', geo ? 'Location category' : 'Category', { sub: geo ? 'geo' : naturalOrder((col.top || []).map(t => t[0])) ? 'ordinal' : null });
}

function decimalsOf(nums) {
  let d = 0;
  for (let i = 0; i < nums.length && i < 2000; i++) {
    const x = nums[i];
    if (!Number.isFinite(x) || Number.isInteger(x)) continue;
    const s = String(x); const k = s.includes('.') ? s.split('.')[1].length : 0;
    if (k > d) d = k;
    if (d >= 2) return 2;
  }
  return d;
}

/* ---------- natural ordering for ordered categories ---------- */
const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
export function naturalOrder(keys) {
  if (!keys || keys.length < 2) return null;
  const low = keys.map(k => String(k).trim().toLowerCase());
  const mIdx = low.map(k => MONTH_NAMES.findIndex(m => k.startsWith(m.toLowerCase())));
  if (mIdx.every(i => i >= 0)) return (a, b) => MONTH_NAMES.findIndex(m => String(a).toLowerCase().startsWith(m.toLowerCase())) - MONTH_NAMES.findIndex(m => String(b).toLowerCase().startsWith(m.toLowerCase()));
  const wIdx = low.map(k => WEEKDAYS.findIndex(d => k.startsWith(d)));
  if (wIdx.every(i => i >= 0)) return (a, b) => WEEKDAYS.findIndex(d => String(a).toLowerCase().startsWith(d)) - WEEKDAYS.findIndex(d => String(b).toLowerCase().startsWith(d));
  if (keys.every(k => /^\s*[<>≤≥]?\s*-?\d/.test(String(k)))) return (a, b) => parseFloat(String(a).replace(/^[^\d-]+/, '')) - parseFloat(String(b).replace(/^[^\d-]+/, ''));
  return null;
}

/* ---------- main entry ---------- */
/**
 * Build the semantic model of a dataset.
 * overrides: { [col]: role } chosen by the user in the Columns view.
 * settings:  { currency: 'auto'|'none'|'₹'|'$'|... }
 */
export function understand(ds, prof, overrides = {}, settings = {}) {
  const N = prof.N;
  const cols = {};
  for (const c of prof.columns) {
    const m = classify(c, ds, N);
    m.auto = m.role;
    m.profile = c;
    const ov = overrides[c.name];
    if (ov && ov !== m.role) applyOverride(m, ov, c);
    cols[c.name] = m;
  }
  // currency: user setting > detected per column > dataset-level detected
  const detected = Object.values(cols).map(m => m.currency).find(Boolean) || null;
  const cur = settings.currency && settings.currency !== 'auto' ? (settings.currency === 'none' ? null : settings.currency) : detected;
  for (const m of Object.values(cols)) if (m.unit === 'currency') m.currency = cur;

  const byRole = r => Object.values(cols).filter(m => m.role === r);
  const measures = byRole('measure');
  const targets = byRole('target');
  const dates = byRole('date').filter(m => m.profile.dates);
  const dims = byRole('dimension');
  const entities = byRole('entity');
  const ids = byRole('id');

  const target = targets.sort((a, b) => targetScore(b) - targetScore(a))[0] || null;
  const primaryMeasure = measures.slice().sort((a, b) => measureScore(b) - measureScore(a))[0] || null;
  const primaryDate = dates.sort((a, b) => (b.profile.dates.n - a.profile.dates.n) || (dateNameScore(b) - dateNameScore(a)))[0] || null;
  const entity = entities.sort((a, b) => (a.sub === 'person' ? -1 : 1) - (b.sub === 'person' ? -1 : 1))[0] || null;

  const domain = detectDomain(Object.values(cols));
  const noun = entityNoun(ids, domain, N);

  return {
    N, cols, order: prof.columns.map(c => c.name), measures, dims, dates, targets, entities, ids,
    target, primaryMeasure, primaryDate, entity, domain, noun: noun.plural, nounOne: noun.one, currency: cur,
  };
}

function applyOverride(m, role, c) {
  m.role = role; m.reason = 'Set by you';
  if (role === 'measure') {
    if (c.type !== 'numeric') { m.role = m.auto; m.reason = 'Only numeric columns can be measures'; return; }
    if (m.unit === 'number' && !m.agg) m.agg = 'mean';
    m.agg = m.agg || 'mean';
  }
  if (role === 'target') {
    const t = targetInfo({ ...c, top: c.top }, [...m.tokens, 'target']);
    if (t) Object.assign(m, t, { sub: 'binary' });
    else { m.role = m.auto; m.reason = 'An outcome needs exactly two values'; }
  }
  if (role === 'date' && c.type !== 'date') { m.role = m.auto; m.reason = 'Values are not dates'; }
}

function measureScore(m) {
  const t = new Set(m.tokens);
  let s = 10;
  if (m.unit === 'currency') s = m.agg === 'sum' ? 80 : 55;
  if (['revenue', 'sales', 'gmv', 'turnover'].some(w => t.has(w))) s = 100;
  if (t.has('profit')) s = 95;
  if (t.has('salary') || t.has('ctc') || t.has('income')) s = 85;
  if (m.unit === 'score') s = Math.max(s, 70) + (t.has('total') ? 6 : 0) + (t.has('cgpa') || t.has('gpa') ? 3 : 0);
  if (m.unit === 'count') s = Math.max(s, m.agg === 'sum' ? 50 : 30);
  if (m.unit === 'percent') s = Math.max(s, 35);
  if (m.unit === 'duration' || m.unit === 'age') s = Math.max(s, 25);
  if (t.has('total') || t.has('net') || t.has('final') || t.has('overall')) s += 4;
  if (t.has('unit') || t.has('per')) s -= 12;
  s -= (m.profile.missingPct || 0) * 40;
  return s;
}
function targetScore(m) { return (hasAny(m.tokens, TARGET) ? 10 : 0) - (m.profile.missingPct || 0) * 10; }
function dateNameScore(m) { return hasAny(m.tokens, W('date order transaction invoice purchase created')) ? 1 : 0; }

function detectDomain(metas) {
  const scores = DOMAINS.map(d => ({ d, s: 0 }));
  for (const m of metas) for (const t of m.tokens) for (const x of scores) if (x.d.words.has(t)) x.s += 1;
  const tgt = metas.find(m => m.role === 'target');
  if (tgt) {
    const t = new Set(tgt.tokens);
    const bump = (k, v) => { const x = scores.find(y => y.d.key === k); if (x) x.s += v; };
    if (t.has('churn') || t.has('churned')) bump('customers', 3);
    if (t.has('attrition')) bump('hr', 3);
    if (t.has('fraud') || t.has('default')) bump('finance', 2);
    if (/rate/.test(tgt.rateLabel || '') && /Pass|Placement/.test(tgt.rateLabel)) bump('education', 2);
  }
  scores.sort((a, b) => b.s - a.s);
  const best = scores[0];
  if (!best || best.s < 2) return { key: 'general', label: 'General dataset', phrase: 'a dataset', noun: 'records' };
  return { key: best.d.key, label: best.d.label, phrase: best.d.phrase, noun: best.d.noun };
}

function entityNoun(ids, domain, N) {
  for (const m of ids) {
    const toks = m.tokens.filter(t => !ID_LAST.has(t) && t !== 'id');
    if (toks.length === 1 && W('row record index serial line entry s sr sl unnamed').has(toks[0])) continue;
    if (toks.length === 1 && toks[0].length >= 2 && !/^\d+$/.test(toks[0])) {
      const p = plural(toks[0]);
      return { plural: p, one: singular(p) };
    }
  }
  const p = domain.noun || 'records';
  return { plural: p, one: singular(p) };
}

/* ==========================================================================
   Formatting
   ========================================================================== */
const nf = (d, locale = 'en-US') => new Intl.NumberFormat(locale, { maximumFractionDigits: d, minimumFractionDigits: 0 });
const NF = {};
const getNF = (d, loc) => (NF[loc + d] ||= nf(d, loc));

export function fmtNumber(v, d = 2, indian = false) {
  if (!Number.isFinite(v)) return '—';
  return getNF(d, indian ? 'en-IN' : 'en-US').format(v).replace(/^-/, '−');
}
export const fmtInt = (v, indian = false) => fmtNumber(Math.round(v), 0, indian);
export function fmtPct(x, d) {
  if (!Number.isFinite(x)) return '—';
  const p = x * 100;
  const dd = d ?? (Math.abs(p) >= 10 || Number.isInteger(Math.round(p * 10) / 10) ? 0 : 1);
  if (p !== 0 && Math.abs(p) < 0.1) return (p < 0 ? '>−' : '<') + '0.1%';
  return p.toFixed(Math.abs(p) < 1 && p !== 0 ? 1 : dd) + '%';
}
export function fmtCompact(v, indian = false) {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v), s = v < 0 ? '−' : '';
  const r = (x, k) => (x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1) : x.toFixed(k)).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
  if (indian) {
    if (a >= 1e7) return s + r(a / 1e7, 2) + ' Cr';
    if (a >= 1e5) return s + r(a / 1e5, 2) + ' L';
    if (a >= 1e3) return s + fmtNumber(a, 0, true);
    return s + fmtNumber(a, a >= 100 ? 0 : 2);
  }
  if (a >= 1e12) return s + r(a / 1e12, 2) + 'T';
  if (a >= 1e9) return s + r(a / 1e9, 2) + 'B';
  if (a >= 1e6) return s + r(a / 1e6, 2) + 'M';
  if (a >= 1e4) return s + r(a / 1e3, 1) + 'K';
  return s + fmtNumber(a, a >= 100 ? 0 : a >= 1 ? 2 : 3);
}

/**
 * Format a value of a measure. opts.compact → short form for tiles/labels.
 * opts.agg: 'sum' | 'mean' | ... (means get one extra decimal for integer data).
 */
export function fmtMeasure(meta, v, opts = {}) {
  if (!Number.isFinite(v)) return '—';
  if (!meta) return opts.compact ? fmtCompact(v) : fmtNumber(v, 2);
  if (opts.withUnit && meta.unit !== 'currency' && meta.unit !== 'percent') {
    const u = unitWord(meta);
    const body = fmtMeasure(meta, v, { ...opts, withUnit: false });
    return u && u !== 'percentage points' ? `${body} ${Math.abs(v) === 1 && u.endsWith('s') ? u.slice(0, -1) : u}` : body;
  }
  const indian = meta.currency === '₹';
  const isMean = opts.agg === 'mean' || opts.agg === 'median';
  const extra = isMean && (meta.decimals || 0) === 0 ? 1 : 0;
  const dec = Math.min(2, (meta.decimals || 0) + extra);
  if (meta.unit === 'percent') {
    const p = meta.fraction ? v * 100 : v;
    return fmtNumber(p, Math.abs(p) >= 10 ? (isMean ? 1 : Math.min(1, dec)) : Math.max(1, Math.min(2, dec))) + '%';
  }
  if (meta.unit === 'currency') {
    const sym = meta.currency || '';
    const a = Math.abs(v);
    const body = opts.compact || a >= 1e5 ? fmtCompact(a, indian) : fmtNumber(a, a >= 100 ? 0 : 2, indian);
    return (v < 0 ? '−' : '') + sym + body;
  }
  if (opts.compact && Math.abs(v) >= 1e4) return fmtCompact(v, indian);
  const d = Math.abs(v) >= 1000 ? 0 : dec;
  return fmtNumber(v, d, indian);
}

/** Unit word for differences, e.g. "marks", "tickets", "months". */
export function unitWord(meta) {
  if (!meta) return '';
  const t = new Set(meta.tokens);
  if (meta.unit === 'percent') return 'percentage points';
  if (t.has('marks') || t.has('mark')) return 'marks';
  if (t.has('months')) return 'months';
  if (t.has('days')) return 'days';
  if (t.has('hours') || t.has('hrs')) return 'hours';
  if (t.has('years') || meta.unit === 'age') return 'years';
  if (t.has('weeks')) return 'weeks';
  if (t.has('tickets')) return 'tickets';
  if (t.has('units')) return 'units';
  if (t.has('points')) return 'points';
  if (t.has('kg') || t.has('kgs')) return 'kg';
  if (meta.unit === 'count') { const last = meta.tokens[meta.tokens.length - 1]; if (last && /s$/.test(last) && last.length > 3) return last; }
  return '';
}

export function fmtDate(t, style = 'day') {
  if (!Number.isFinite(t)) return '—';
  const d = new Date(t);
  const M = MONTH_NAMES[d.getUTCMonth()];
  if (style === 'month') return `${M} ${d.getUTCFullYear()}`;
  if (style === 'year') return String(d.getUTCFullYear());
  return `${d.getUTCDate()} ${M} ${d.getUTCFullYear()}`;
}

/** Dimensions where "concentrate / learn from / prioritise" advice makes business sense. */
export const ACTIONABLE = W('category categories product products item items brand brands region city state country market zone area territory store branch outlet segment customer client supplier vendor department dept team section class school course subject faculty teacher channel source campaign plan contract tier role job manager warehouse route program programme batch project service services');
export const isActionable = meta => meta && meta.tokens.some(t => ACTIONABLE.has(t));
export const SENSITIVE = W('gender sex religion caste race ethnicity ethnic nationality marital disability orientation');
export const isSensitive = meta => meta && meta.tokens.some(t => SENSITIVE.has(t));

/** Comparative adjectives that read naturally for a measure: ['more','fewer'], ['longer','shorter']… */
export function comparatives(meta) {
  if (!meta) return ['higher', 'lower'];
  if (meta.unit === 'count') return ['more', 'fewer'];
  if (meta.unit === 'duration') return ['longer', 'shorter'];
  if (meta.unit === 'age') return ['older', 'younger'];
  return ['higher', 'lower'];
}

export const ROLE_INFO = {
  measure: { label: 'Measure', desc: 'A number to total or average (revenue, marks, age)' },
  dimension: { label: 'Category', desc: 'Groups to compare (city, branch, plan)' },
  date: { label: 'Date', desc: 'When something happened — used for trends' },
  target: { label: 'Outcome', desc: 'A yes/no result to explain (churned, passed)' },
  entity: { label: 'Name', desc: 'Individual items or people — used for rankings' },
  id: { label: 'Identifier', desc: 'Unique code per row — not analysed' },
  text: { label: 'Free text', desc: 'Comments or descriptions' },
  contact: { label: 'Contact', desc: 'Emails, phones or links — not analysed' },
  ignore: { label: 'Ignore', desc: 'Excluded from the analysis' },
};
