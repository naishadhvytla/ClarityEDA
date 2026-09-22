/* Clarity — built-in sample datasets (deterministic, with realistic quirks to clean). */

function rng(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const weighted = (r, pairs) => { const tot = pairs.reduce((s, p) => s + p[1], 0); let x = r() * tot; for (const [v, w] of pairs) { if ((x -= w) <= 0) return v; } return pairs[pairs.length - 1][0]; };
const normal = r => { let u = 0, v = 0; while (!u) u = r(); while (!v) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const csvCell = v => { const s = String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const toCSV = rows => rows.map(r => r.map(csvCell).join(',')).join('\n');
const pad = n => String(n).padStart(2, '0');

function sales() {
  const r = rng(7);
  const cats = { Electronics: [['Headphones', 2200], ['Smart TV', 32000], ['Laptop', 54000], ['Phone charger', 900]],
    Apparel: [['Saree', 3200], ['Kurta', 1400], ['Jeans', 1900], ['T-shirt', 650]],
    'Home & Kitchen': [['Mixer grinder', 3800], ['Cookware set', 2600], ['Water bottle', 450], ['Table lamp', 1200]],
    Grocery: [['Rice 5kg', 420], ['Sugar 1kg', 48], ['Sunflower oil 1L', 165], ['Tea 500g', 260]],
    'Personal Care': [['Shampoo', 320], ['Soap pack', 180], ['Sunscreen', 450], ['Body lotion', 390]] };
  const catW = [['Electronics', 20], ['Apparel', 26], ['Home & Kitchen', 18], ['Grocery', 22], ['Personal Care', 14]];
  const cities = [['Visakhapatnam', 26], ['Vijayawada', 24], ['Guntur', 20], ['Tirupati', 16], ['Nellore', 14]];
  const rows = [['order_id', 'order_date', 'customer_type', 'city', 'category', 'product', 'units', 'unit_price_inr', 'discount_pct', 'payment_method', 'revenue_inr']];
  const start = Date.UTC(2026, 0, 1);
  for (let i = 0; i < 600; i++) {
    const day = Math.floor(Math.pow(r(), 0.85) * 181);
    const d = new Date(start + day * 86400000);
    const month = d.getUTCMonth();
    let cat = weighted(r, catW);
    if (cat === 'Electronics' && r() < month * 0.07) cat = 'Apparel';
    const [product, base] = pick(r, cats[cat]);
    const units = cat === 'Grocery' ? 1 + Math.floor(r() * 6) : 1 + Math.floor(Math.pow(r(), 2) * 3);
    let price = Math.round(base * (0.85 + r() * 0.3));
    const disc = weighted(r, [[0, 40], [5, 20], [10, 20], [15, 12], [20, 8]]);
    const priceFactor = cat === 'Electronics' ? 1 - month * 0.05 : cat === 'Apparel' ? 1 + month * 0.06 : 1;
    const revenue = Math.round(units * price * (1 - disc / 100) * priceFactor);
    if (i === 40 || i === 333) price = price * 12;
    let city = weighted(r, cities);
    if (i % 61 === 0) city = city.toLowerCase();
    if (i % 97 === 0) city = city + ' ';
    const cityV = i % 37 === 0 ? '' : city;
    const discV = i % 53 === 0 ? '' : disc;
    const ctype = r() < 0.38 + month * 0.03 ? 'Returning' : 'New';
    const pay = weighted(r, [['UPI', 46], ['Card', 28], ['Cash on delivery', 18], ['Net banking', 8]]);
    rows.push([10001 + i, `${d.getUTCFullYear()}-${pad(month + 1)}-${pad(d.getUTCDate())}`, ctype, cityV, cat, product, units, price, discV, pay, revenue]);
  }
  rows.sort((a, b) => (a[0] === 'order_id' ? -1 : b[0] === 'order_id' ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  rows.slice(1).forEach((row, i) => { row[0] = 10001 + i; });
  rows.push(rows[6].slice(), rows[121].slice());
  return toCSV(rows);
}

function churn() {
  const r = rng(13);
  const plans = [['Basic', 45, 299], ['Standard', 35, 599], ['Premium', 20, 999]];
  const regions = [['North', 28], ['South', 32], ['East', 18], ['West', 22]];
  const rows = [['customer_id', 'signup_date', 'plan', 'monthly_fee', 'tenure_months', 'support_tickets', 'region', 'payment_method', 'churned']];
  for (let i = 0; i < 520; i++) {
    const planRow = weighted(r, plans.map(p => [p, p[1]]));
    const plan = planRow[0], fee = planRow[2];
    const tenure = 1 + Math.floor(Math.pow(r(), 1.3) * 48);
    const tickets = Math.max(0, Math.round(Math.abs(normal(r)) * 2 + (r() < 0.15 ? 3 : 0)));
    const pay = r() < 0.55 ? 'Auto-pay' : 'Manual';
    const region = weighted(r, regions);
    let p = 0.1 + tickets * 0.07 - tenure * 0.004 + (plan === 'Basic' ? 0.06 : plan === 'Premium' ? -0.03 : 0) + (pay === 'Manual' ? 0.08 : -0.02) + (region === 'East' ? 0.04 : 0);
    const churned = r() < clamp(p, 0.02, 0.9) ? 'Yes' : 'No';
    const signup = new Date(Date.UTC(2023, 0, 1) + Math.floor(r() * 900) * 86400000);
    const date = `${pad(signup.getUTCDate())}/${pad(signup.getUTCMonth() + 1)}/${signup.getUTCFullYear()}`;
    rows.push([`CUS-${5001 + i}`, date, plan, i % 29 === 0 ? '' : fee, tenure, tickets, i % 41 === 0 ? '' : region, pay, churned]);
  }
  rows.push(rows[3].slice());
  return toCSV(rows);
}

function students() {
  const r = rng(35);
  const branches = [['CSE', 32], ['ECE', 18], ['EEE', 12], ['ME', 12], ['CE', 10], ['AI&DS', 16]];
  const bonus = { CSE: 3, 'AI&DS': 2, ECE: 1, EEE: -1, ME: -2, CE: -2 };
  const rows = [['student_id', 'gender', 'branch', 'section', 'attendance_pct', 'study_hours_per_week', 'internal_marks', 'external_marks', 'total_marks', 'cgpa', 'backlogs', 'result']];
  for (let i = 0; i < 480; i++) {
    const branch = weighted(r, branches);
    const gender = r() < 0.58 ? 'Male' : 'Female';
    const section = pick(r, ['A', 'B', 'C', 'D']);
    const att = Math.round(clamp(78 + normal(r) * 11, 38, 100));
    const hours = Math.round(clamp(10 + normal(r) * 4.5, 1, 28));
    const ability = normal(r);
    const total = Math.round(clamp(52 + 0.42 * (att - 78) + 1.1 * (hours - 10) + 9 * ability + bonus[branch] + normal(r) * 5 + (gender === 'Female' ? 1.5 : 0), 8, 99));
    const internal = Math.round(clamp(total * 0.4 + normal(r) * 2.5, 0, 40));
    const external = clamp(total - internal, 0, 60);
    const cgpa = Math.round(clamp(3.2 + total * 0.068 + normal(r) * 0.35, 4, 10) * 100) / 100;
    const backlogs = total < 40 ? 2 + Math.floor(r() * 3) : total < 50 ? Math.floor(r() * 3) : r() < 0.08 ? 1 : 0;
    const result = total < 40 || backlogs >= 3 ? 'Fail' : 'Pass';
    let b = branch;
    if (i % 53 === 0) b = branch.toLowerCase();
    if (i % 71 === 0) b = branch + ' ';
    rows.push([`KL${23001 + i}`, gender, b, section, i % 23 === 0 ? '' : att, hours, internal, internal + external === total ? external : external, total, cgpa, backlogs, result]);
  }
  rows.push(rows[10].slice(), rows[222].slice(), rows[400].slice());
  return toCSV(rows);
}

export const SAMPLES = [
  { id: 'sales', file: 'retail_sales_2026.csv', title: 'Retail sales', icon: 'cart', blurb: '600 orders across 5 cities and 5 categories, Jan–Jun 2026.', build: sales },
  { id: 'students', file: 'student_performance.csv', title: 'Student performance', icon: 'cap', blurb: '480 students across 6 branches: attendance, marks, CGPA, results.', build: students },
  { id: 'churn', file: 'customer_churn.csv', title: 'Customer churn', icon: 'users', blurb: '520 subscribers with plan, tenure, tickets and churn outcome.', build: churn },
];
