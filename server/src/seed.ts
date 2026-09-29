/**
 * Fills an empty database with a realistic week so the app can be explored
 * before any real patient is entered. Safe to run repeatedly: it refuses to
 * touch a database that already has patients in it.
 */
import { db, getSetting, migrate } from './db.js';

migrate();

const existing = db.prepare('SELECT COUNT(*) AS n FROM patients').get() as { n: number };
if (existing.n > 0) {
  console.log(`Database already has ${existing.n} patient(s) — leaving it alone.`);
  process.exit(0);
}

function addDays(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

interface SeedCase {
  diagnosis: string;
  procedure: string;
  laterality?: string;
  anaesthesia?: string;
  priority?: string;
  status: string;
  duration_min: number;
  is_daycare?: number;
  is_infected?: number;
  blood_units?: number;
  equipment?: string;
  implants?: string;
  special_notes?: string;
  consent_signed?: number;
  anaesthetic_clear?: number;
  scheduled_date?: string | null;
  workup_done?: number;
}

interface SeedPatient {
  name: string;
  mrn: string;
  sex: string;
  age_years: number;
  phone: string;
  blood_group?: string;
  comorbidities?: string;
  allergies?: string;
  cases: SeedCase[];
}

const listDate = addDays(3);
const secondListDate = addDays(10);

const people: SeedPatient[] = [
  {
    name: 'Meera Raghavan',
    mrn: 'UH-10241',
    sex: 'female',
    age_years: 46,
    phone: '+91 98400 11223',
    blood_group: 'B+',
    comorbidities: 'Type 2 diabetes mellitus, hypothyroidism',
    cases: [
      {
        diagnosis: 'Symptomatic cholelithiasis',
        procedure: 'Laparoscopic cholecystectomy',
        status: 'confirmed',
        duration_min: 75,
        is_daycare: 1,
        equipment: 'Laparoscopy stack',
        consent_signed: 1,
        anaesthetic_clear: 1,
        scheduled_date: listDate,
        workup_done: 10,
      },
    ],
  },
  {
    name: 'Arjun Nair',
    mrn: 'UH-10388',
    sex: 'male',
    age_years: 8,
    phone: '+91 99620 55110',
    blood_group: 'O+',
    cases: [
      {
        diagnosis: 'Right inguinal hernia',
        procedure: 'Open inguinal herniotomy',
        laterality: 'right',
        status: 'confirmed',
        duration_min: 45,
        is_daycare: 1,
        consent_signed: 1,
        anaesthetic_clear: 1,
        scheduled_date: listDate,
        workup_done: 10,
      },
    ],
  },
  {
    name: 'Sunita Deshmukh',
    mrn: 'UH-10402',
    sex: 'female',
    age_years: 61,
    phone: '+91 98211 74300',
    blood_group: 'A+',
    comorbidities: 'Hypertension, CKD stage 2',
    allergies: 'Penicillin',
    cases: [
      {
        diagnosis: 'Carcinoma right breast, T2N1',
        procedure: 'Modified radical mastectomy',
        laterality: 'right',
        priority: 'urgent',
        status: 'confirmed',
        duration_min: 150,
        blood_units: 2,
        special_notes: 'Frozen section for margins; oncology review booked post-op',
        consent_signed: 1,
        anaesthetic_clear: 1,
        scheduled_date: listDate,
        workup_done: 10,
      },
    ],
  },
  {
    name: 'Ramesh Pillai',
    mrn: 'UH-10455',
    sex: 'male',
    age_years: 54,
    phone: '+91 90030 21877',
    comorbidities: 'Type 2 diabetes mellitus',
    cases: [
      {
        diagnosis: 'Chronic diabetic foot ulcer with osteomyelitis, left great toe',
        procedure: 'Ray amputation, left great toe',
        laterality: 'left',
        status: 'confirmed',
        duration_min: 60,
        is_infected: 1,
        special_notes: 'Septic case — keep last on the list',
        consent_signed: 1,
        anaesthetic_clear: 1,
        scheduled_date: listDate,
        workup_done: 9,
      },
    ],
  },
  {
    name: 'Fatima Sheikh',
    mrn: 'UH-10490',
    sex: 'female',
    age_years: 34,
    phone: '+91 98999 30021',
    cases: [
      {
        diagnosis: 'Multinodular goitre with compressive symptoms',
        procedure: 'Total thyroidectomy',
        status: 'offered',
        duration_min: 120,
        blood_units: 1,
        equipment: 'Nerve monitor, harmonic',
        scheduled_date: secondListDate,
        workup_done: 8,
      },
    ],
  },
  {
    name: 'Joseph Mathew',
    mrn: 'UH-10512',
    sex: 'male',
    age_years: 67,
    phone: '+91 94470 88123',
    comorbidities: 'CAD, on clopidogrel',
    cases: [
      {
        diagnosis: 'Left inguinal hernia',
        procedure: 'Laparoscopic TEP repair',
        laterality: 'left',
        status: 'workup',
        duration_min: 90,
        equipment: 'Laparoscopy stack',
        implants: 'Polypropylene mesh 15x15',
        special_notes: 'Cardiology clearance pending; stop clopidogrel 5 days pre-op',
        workup_done: 5,
      },
    ],
  },
  {
    name: 'Kavya Krishnan',
    mrn: 'UH-10533',
    sex: 'female',
    age_years: 29,
    phone: '+91 97890 44567',
    cases: [
      {
        diagnosis: 'Fibroadenoma left breast',
        procedure: 'Lumpectomy',
        laterality: 'left',
        status: 'ready',
        duration_min: 45,
        is_daycare: 1,
        consent_signed: 1,
        workup_done: 10,
      },
    ],
  },
  {
    name: 'Harish Gowda',
    mrn: 'UH-10559',
    sex: 'male',
    age_years: 41,
    phone: '+91 96320 77410',
    cases: [
      {
        diagnosis: 'Grade 3 haemorrhoids',
        procedure: 'Stapled haemorrhoidopexy',
        status: 'ready',
        duration_min: 50,
        is_daycare: 1,
        workup_done: 10,
      },
    ],
  },
];

const template: string[] = (() => {
  try {
    const parsed = JSON.parse(getSetting('workup_template') ?? '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
})();

const insertPatient = db.prepare(
  `INSERT INTO patients (name, mrn, sex, age_years, phone, blood_group, comorbidities, allergies)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
);

const insertCase = db.prepare(
  `INSERT INTO cases (patient_id, diagnosis, procedure, laterality, anaesthesia, priority,
                      status, duration_min, is_daycare, is_infected, blood_units, equipment,
                      implants, special_notes, consent_signed, anaesthetic_clear, scheduled_date)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);

const insertWorkup = db.prepare(
  `INSERT INTO workup_items (case_id, label, done, position, done_at)
   VALUES (?, ?, ?, ?, CASE WHEN ? = 1 THEN datetime('now') ELSE NULL END)`,
);

const seed = db.transaction(() => {
  for (const person of people) {
    const patientId = Number(
      insertPatient.run(
        person.name,
        person.mrn,
        person.sex,
        person.age_years,
        person.phone,
        person.blood_group ?? null,
        person.comorbidities ?? null,
        person.allergies ?? null,
      ).lastInsertRowid,
    );

    for (const c of person.cases) {
      const caseId = Number(
        insertCase.run(
          patientId,
          c.diagnosis,
          c.procedure,
          c.laterality ?? 'na',
          c.anaesthesia ?? 'ga',
          c.priority ?? 'routine',
          c.status,
          c.duration_min,
          c.is_daycare ?? 0,
          c.is_infected ?? 0,
          c.blood_units ?? 0,
          c.equipment ?? null,
          c.implants ?? null,
          c.special_notes ?? null,
          c.consent_signed ?? 0,
          c.anaesthetic_clear ?? 0,
          c.scheduled_date ?? null,
        ).lastInsertRowid,
      );

      template.forEach((label, i) => {
        const done = i < (c.workup_done ?? 0) ? 1 : 0;
        insertWorkup.run(caseId, label, done, i, done);
      });
    }
  }

  // One patient who has been rung and asked to call back, so the dashboard
  // worklist is not empty on first run.
  const offered = db
    .prepare(`SELECT id, scheduled_date FROM cases WHERE status = 'offered' LIMIT 1`)
    .get() as { id: number; scheduled_date: string } | undefined;
  if (offered) {
    db.prepare(
      `INSERT INTO call_logs (case_id, offered_date, outcome, notes, next_call_on)
       VALUES (?, ?, 'callback', 'Asked to confirm with family, will ring back', date('now','+1 day'))`,
    ).run(offered.id, offered.scheduled_date);
  }
});

seed();

console.log(`Seeded ${people.length} patients.`);
console.log(`  Theatre day with cases ready to list: ${listDate}`);
console.log(`  Second provisional date:              ${secondListDate}`);
console.log('Generate the list for the first date from the OT Lists page.');
