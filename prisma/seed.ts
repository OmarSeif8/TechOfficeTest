// =============================================================================
// TechOffice — Prisma Seed Script (Phase 1 web build, WO-W-2)
// =============================================================================
// Source of truth:
//   * docs/planning/ERD_V1.1_WEB.md §8 — Seed Data Appendix
//   * docs/imported/full-conversation.json turn 30 — APPENDIX_SEED_DATA.md
//   * Task WO-W-2 spec (authoritative for the exact 23 library items + 10
//     categories used in this Phase 1 web build)
//
// Scope:
//   * Reference data ONLY — no users, no auth (auth is WO-W-7).
//   * Master tables: Unit, UnitAlias, RebarDiameter, ShapeCode
//   * Library: LibraryCategory (10 top-level), ItemLibrary (23 starter items)
//
// Idempotency:
//   * Unit / UnitAlias / RebarDiameter / ShapeCode use Prisma `upsert` on their
//     @unique fields (code, alias, diameterMm, code respectively).
//   * LibraryCategory.nameEn and ItemLibrary.(code+scope) are not declared
//     @unique in the schema (WO-W-1 constraint), so those use a
//     findFirst → update | create helper. Running this script twice yields
//     the same row count and same data — no duplicates, no errors.
//
// Run:
//   bun run db:seed
// =============================================================================
import { db } from "@/lib/db";

// -----------------------------------------------------------------------------
// 1. UNITS (9 rows)
// -----------------------------------------------------------------------------
const UNITS = [
  { code: "m",   nameEn: "Meter",      nameAr: "متر",          defaultPrecision: 2 },
  { code: "m2",  nameEn: "Square Meter", nameAr: "متر مربع",  defaultPrecision: 2 },
  { code: "m3",  nameEn: "Cubic Meter", nameAr: "متر مكعب",    defaultPrecision: 3 },
  { code: "ton", nameEn: "Ton",        nameAr: "طن",           defaultPrecision: 3 },
  { code: "kg",  nameEn: "Kilogram",   nameAr: "كيلوجرام",     defaultPrecision: 2 },
  { code: "no",  nameEn: "Number",     nameAr: "عدد",          defaultPrecision: 0 },
  { code: "lot", nameEn: "Lot",        nameAr: "مقطوعية",      defaultPrecision: 0 },
  { code: "hr",  nameEn: "Hour",       nameAr: "ساعة",         defaultPrecision: 1 },
  { code: "sum", nameEn: "Lump Sum",   nameAr: "مبلغ مقطوع",   defaultPrecision: 0 },
] as const;

// -----------------------------------------------------------------------------
// 2. UNIT ALIASES (~38 rows — fuzzy matching for unit input)
//    Keys are unit codes; values are the alias strings to register.
//    The `alias` column is @unique so upsert-by-alias is safe.
// -----------------------------------------------------------------------------
const UNIT_ALIASES: Record<string, readonly string[]> = {
  m:   ["m", "meter", "metre", "متر"],
  m2:  ["m2", "m²", "sqm", "sq.m", "متر مربع", "م2"],
  m3:  ["m3", "m³", "cum", "cu.m", "متر مكعب", "م3"],
  ton: ["ton", "tonne", "t", "طن"],
  kg:  ["kg", "kilo", "كجم", "كيلوجرام"],
  no:  ["no", "nos", "nr", "عدد"],
  lot: ["lot", "lump", "مقطوعية"],
  hr:  ["hr", "hour", "hrs", "ساعة"],
  sum: ["sum", "lump sum", "مبلغ مقطوع"],
};

// -----------------------------------------------------------------------------
// 3. REBAR DIAMETERS (13 rows — BR-11 weight table)
//    Stored as decimal strings per Constitution v1.1 §5 (decimal.js on app side).
// -----------------------------------------------------------------------------
const REBAR_DIAMETERS = [
  { diameterMm: 6,  weightKgPerM: "0.222" },
  { diameterMm: 8,  weightKgPerM: "0.395" },
  { diameterMm: 10, weightKgPerM: "0.617" },
  { diameterMm: 12, weightKgPerM: "0.888" },
  { diameterMm: 14, weightKgPerM: "1.21" },
  { diameterMm: 16, weightKgPerM: "1.58" },
  { diameterMm: 18, weightKgPerM: "2.00" },
  { diameterMm: 20, weightKgPerM: "2.47" },
  { diameterMm: 22, weightKgPerM: "2.98" },
  { diameterMm: 25, weightKgPerM: "3.85" },
  { diameterMm: 28, weightKgPerM: "4.83" },
  { diameterMm: 32, weightKgPerM: "6.31" },
  { diameterMm: 36, weightKgPerM: "7.99" },
] as const;

// -----------------------------------------------------------------------------
// 4. SHAPE CODES (8 rows — BBS shape codes, text-only in Phase 1)
// -----------------------------------------------------------------------------
const SHAPE_CODES = [
  { code: "00", nameEn: "Straight",         nameAr: "مستقيم" },
  { code: "01", nameEn: "L-bend",            nameAr: "زاوية قائمة" },
  { code: "11", nameEn: "Hook one end",      nameAr: "كالة طرف واحد" },
  { code: "21", nameEn: "L + Hook",          nameAr: "زاوية + كالة" },
  { code: "31", nameEn: "U-bend",            nameAr: "شكل U" },
  { code: "41", nameEn: "Stirrup",           nameAr: "كانات" },
  { code: "51", nameEn: "Crank",             nameAr: "مكسح" },
  { code: "99", nameEn: "Custom",            nameAr: "مخصص" },
] as const;

// -----------------------------------------------------------------------------
// 5. LIBRARY CATEGORIES (10 top-level)
// -----------------------------------------------------------------------------
const LIBRARY_CATEGORIES = [
  { nameEn: "CONCRETE",      nameAr: "خرسانة",            sortOrder: 1 },
  { nameEn: "FORMWORK",      nameAr: "شدات",              sortOrder: 2 },
  { nameEn: "REBAR",         nameAr: "حديد تسليح",        sortOrder: 3 },
  { nameEn: "MASONRY",       nameAr: "مباني",             sortOrder: 4 },
  { nameEn: "PLASTER",       nameAr: "محارة",              sortOrder: 5 },
  { nameEn: "PAINT",         nameAr: "دهانات",             sortOrder: 6 },
  { nameEn: "TILES",         nameAr: "بلاطات",             sortOrder: 7 },
  { nameEn: "DOORS_WINDOWS", nameAr: "أبواب ونوافذ",       sortOrder: 8 },
  { nameEn: "ELECTRICAL",    nameAr: "أعمال كهربائية",     sortOrder: 9 },
  { nameEn: "PLUMBING",      nameAr: "أعمال صحية",         sortOrder: 10 },
] as const;

// -----------------------------------------------------------------------------
// 6. STARTER LIBRARY ITEMS (23 rows — scope: APP_GLOBAL)
//    Each item references a category by its nameEn and a unit by its code,
//    resolved at seed time. Rates are intentionally blank per spec
//    (turn 30: "rates blank; extend to ~150 within taxonomy").
// -----------------------------------------------------------------------------
type LibraryItemInput = {
  code: string;
  categoryNameEn: string;
  descriptionEn: string;
  descriptionAr: string;
  unitCode: string;
  defaultSpecsEn?: string;
  defaultSpecsAr?: string;
};

const LIBRARY_ITEMS: LibraryItemInput[] = [
  // — Concrete (6) —
  {
    code: "C15",
    categoryNameEn: "CONCRETE",
    descriptionEn: "Ready-mix concrete grade C15, 28-day strength",
    descriptionAr: "خرسانة جاهزة درجة C15، مقاومة 28 يوم",
    unitCode: "m3",
    defaultSpecsEn: "Cube strength 15 N/mm² at 28 days, slump 100±25 mm",
    defaultSpecsAr: "مقاومة مكعب 15 نيوتن/مم² عند 28 يوم، قوام 100±25 مم",
  },
  {
    code: "C20",
    categoryNameEn: "CONCRETE",
    descriptionEn: "Ready-mix concrete grade C20, 28-day strength",
    descriptionAr: "خرسانة جاهزة درجة C20، مقاومة 28 يوم",
    unitCode: "m3",
    defaultSpecsEn: "Cube strength 20 N/mm² at 28 days, slump 100±25 mm",
    defaultSpecsAr: "مقاومة مكعب 20 نيوتن/مم² عند 28 يوم، قوام 100±25 مم",
  },
  {
    code: "C25",
    categoryNameEn: "CONCRETE",
    descriptionEn: "Ready-mix concrete grade C25, 28-day strength",
    descriptionAr: "خرسانة جاهزة درجة C25، مقاومة 28 يوم",
    unitCode: "m3",
    defaultSpecsEn: "Cube strength 25 N/mm² at 28 days, slump 100±25 mm",
    defaultSpecsAr: "مقاومة مكعب 25 نيوتن/مم² عند 28 يوم، قوام 100±25 مم",
  },
  {
    code: "C30",
    categoryNameEn: "CONCRETE",
    descriptionEn: "Ready-mix concrete grade C30, 28-day strength",
    descriptionAr: "خرسانة جاهزة درجة C30، مقاومة 28 يوم",
    unitCode: "m3",
    defaultSpecsEn: "Cube strength 30 N/mm² at 28 days, slump 100±25 mm",
    defaultSpecsAr: "مقاومة مكعب 30 نيوتن/مم² عند 28 يوم، قوام 100±25 مم",
  },
  {
    code: "C35",
    categoryNameEn: "CONCRETE",
    descriptionEn: "Ready-mix concrete grade C35, 28-day strength",
    descriptionAr: "خرسانة جاهزة درجة C35، مقاومة 28 يوم",
    unitCode: "m3",
    defaultSpecsEn: "Cube strength 35 N/mm² at 28 days, slump 100±25 mm",
    defaultSpecsAr: "مقاومة مكعب 35 نيوتن/مم² عند 28 يوم، قوام 100±25 مم",
  },
  {
    code: "C40",
    categoryNameEn: "CONCRETE",
    descriptionEn: "Ready-mix concrete grade C40, 28-day strength",
    descriptionAr: "خرسانة جاهزة درجة C40، مقاومة 28 يوم",
    unitCode: "m3",
    defaultSpecsEn: "Cube strength 40 N/mm² at 28 days, slump 100±25 mm",
    defaultSpecsAr: "مقاومة مكعب 40 نيوتن/مم² عند 28 يوم، قوام 100±25 مم",
  },

  // — Formwork (2) —
  {
    code: "FORM-PLY-18",
    categoryNameEn: "FORMWORK",
    descriptionEn: "18mm plywood formwork system, supply & erect",
    descriptionAr: "نظام شدات خشبية بمقصورات 18 مم، توريد وتركيب",
    unitCode: "m2",
    defaultSpecsEn: "18 mm marine plywood, steel soldiers & props, ≥3 uses",
    defaultSpecsAr: "خشب مقصورات بحري 18 مم، كمرات معدنية ودعامات، ≥3 استخدامات",
  },
  {
    code: "FORM-STEEL",
    categoryNameEn: "FORMWORK",
    descriptionEn: "Steel formwork system, supply & erect",
    descriptionAr: "نظام شدات معدنية، توريد وتركيب",
    unitCode: "m2",
    defaultSpecsEn: "Patented steel panel system, ≥50 uses",
    defaultSpecsAr: "نظام ألواح معدنية مسجلة، ≥50 استخدام",
  },

  // — Rebar (5) —
  {
    code: "R8",
    categoryNameEn: "REBAR",
    descriptionEn: "Reinforcement bar Ø8 mm, grade B500B",
    descriptionAr: "حديد تسليح قطر 8 مم، درجة B500B",
    unitCode: "ton",
    defaultSpecsEn: "Grade B500B per EN 10080, deformed bars",
    defaultSpecsAr: "درجة B500B طبق EN 10080، حديد مضلع",
  },
  {
    code: "R10",
    categoryNameEn: "REBAR",
    descriptionEn: "Reinforcement bar Ø10 mm, grade B500B",
    descriptionAr: "حديد تسليح قطر 10 مم، درجة B500B",
    unitCode: "ton",
    defaultSpecsEn: "Grade B500B per EN 10080, deformed bars",
    defaultSpecsAr: "درجة B500B طبق EN 10080، حديد مضلع",
  },
  {
    code: "R12",
    categoryNameEn: "REBAR",
    descriptionEn: "Reinforcement bar Ø12 mm, grade B500B",
    descriptionAr: "حديد تسليح قطر 12 مم، درجة B500B",
    unitCode: "ton",
    defaultSpecsEn: "Grade B500B per EN 10080, deformed bars",
    defaultSpecsAr: "درجة B500B طبق EN 10080، حديد مضلع",
  },
  {
    code: "R16",
    categoryNameEn: "REBAR",
    descriptionEn: "Reinforcement bar Ø16 mm, grade B500B",
    descriptionAr: "حديد تسليح قطر 16 مم، درجة B500B",
    unitCode: "ton",
    defaultSpecsEn: "Grade B500B per EN 10080, deformed bars",
    defaultSpecsAr: "درجة B500B طبق EN 10080، حديد مضلع",
  },
  {
    code: "R20",
    categoryNameEn: "REBAR",
    descriptionEn: "Reinforcement bar Ø20 mm, grade B500B",
    descriptionAr: "حديد تسليح قطر 20 مم، درجة B500B",
    unitCode: "ton",
    defaultSpecsEn: "Grade B500B per EN 10080, deformed bars",
    defaultSpecsAr: "درجة B500B طبق EN 10080، حديد مضلع",
  },

  // — Masonry (2) —
  {
    code: "BLOCK-200",
    categoryNameEn: "MASONRY",
    descriptionEn: "200mm hollow concrete block, supply & lay",
    descriptionAr: "بلوك خرساني مفرغ 200 مم، توريد وتركيب",
    unitCode: "no",
    defaultSpecsEn: "Hollow concrete block 400×200×200 mm, ≥5 N/mm²",
    defaultSpecsAr: "بلوك خرساني مفرغ 400×200×200 مم، ≥5 نيوتن/مم²",
  },
  {
    code: "BRICK-RED",
    categoryNameEn: "MASONRY",
    descriptionEn: "Red clay brick, supply & lay",
    descriptionAr: "طوب طيني أحمر، توريد وتركيب",
    unitCode: "no",
    defaultSpecsEn: "Red clay brick 250×120×65 mm, first quality",
    defaultSpecsAr: "طوب طيني أحمر 250×120×65 مم، درجة أولى",
  },

  // — Plaster (1) —
  {
    code: "PLASTER-CEM",
    categoryNameEn: "PLASTER",
    descriptionEn: "Cement plaster 1:4, 20mm thick, three-coat",
    descriptionAr: "محارة أسمنتية 1:4 بسمك 20 مم بثلاث طبقات",
    unitCode: "m2",
    defaultSpecsEn: "Cement:sand 1:4, 20 mm thick, three-coat work",
    defaultSpecsAr: "أسمنت:رمل 1:4، سمك 20 مم، ثلاث طبقات",
  },

  // — Paint (2) —
  {
    code: "PAINT-INT",
    categoryNameEn: "PAINT",
    descriptionEn: "Interior acrylic paint, putty + primer + 2 coats",
    descriptionAr: "دهانات أكريليك داخلية: معجون + وجه تأسيس + وجهين",
    unitCode: "m2",
    defaultSpecsEn: "Acrylic emulsion, putty + primer + 2 finishing coats",
    defaultSpecsAr: "أكريليك، معجون + وجه تأسيس + وجهين نهائيين",
  },
  {
    code: "PAINT-EXT",
    categoryNameEn: "PAINT",
    descriptionEn: "Exterior weatherproof paint, primer + 2 coats",
    descriptionAr: "دهانات خارجية مقاومة للعوامل الجوية: تأسيس + وجهين",
    unitCode: "m2",
    defaultSpecsEn: "Weather-resistant acrylic, primer + 2 coats",
    defaultSpecsAr: "أكريليك مقاوم للعوامل الجوية، تأسيس + وجهين",
  },

  // — Tiles (2) —
  {
    code: "TILE-CER-300",
    categoryNameEn: "TILES",
    descriptionEn: "300x300 ceramic floor tile, incl. mortar & grouting",
    descriptionAr: "بلاط سيراميك أرضيات 300×300 شامل الفرش واللحام",
    unitCode: "m2",
    defaultSpecsEn: "Ceramic floor tile 300×300 mm, first quality, incl. bedding & grout",
    defaultSpecsAr: "بلاط سيراميك أرضيات 300×300 مم، درجة أولى، شامل الفرش واللحام",
  },
  {
    code: "TILE-POR-600",
    categoryNameEn: "TILES",
    descriptionEn: "600x600 porcelain floor tile, incl. mortar & grouting",
    descriptionAr: "بلاط بورسلين أرضيات 600×600 شامل الفرش واللحام",
    unitCode: "m2",
    defaultSpecsEn: "Porcelain floor tile 600×600 mm, first quality, incl. bedding & grout",
    defaultSpecsAr: "بلاط بورسلين أرضيات 600×600 مم، درجة أولى، شامل الفرش واللحام",
  },

  // — Doors/Windows (1) —
  {
    code: "DOOR-INT-WOOD",
    categoryNameEn: "DOORS_WINDOWS",
    descriptionEn: "Interior wooden door, supply & install, incl. frame",
    descriptionAr: "باب خشبي داخلي، توريد وتركيب شامل الإطار",
    unitCode: "no",
    defaultSpecsEn: "Solid-core wooden door 90×210 cm, incl. wooden frame & hinges",
    defaultSpecsAr: "باب خشبي بقلب مصمت 90×210 سم، شامل إطار واروزات خشبية",
  },

  // — Electrical (1) —
  {
    code: "ELEC-PIPE-PVC",
    categoryNameEn: "ELECTRICAL",
    descriptionEn: "PVC conduit pipe, supply & install",
    descriptionAr: "مواسير PVC للكهرباء، توريد وتركيب",
    unitCode: "no",
    defaultSpecsEn: "Rigid PVC conduit Ø20 mm, per IEC 60614",
    defaultSpecsAr: "مواسير PVC صلبة قطر 20 مم، طبق IEC 60614",
  },

  // — Plumbing (1) —
  {
    code: "PLUMB-PIPE-PPR",
    categoryNameEn: "PLUMBING",
    descriptionEn: "PPR water pipe, supply & install",
    descriptionAr: "مواسير PPR للمياه، توريد وتركيب",
    unitCode: "no",
    defaultSpecsEn: "PPR pipe Ø25 mm, PN20, per DIN 8077",
    defaultSpecsAr: "مواسير PPR قطر 25 مم، PN20، طبق DIN 8077",
  },
];

// -----------------------------------------------------------------------------
// Helpers — upsert by non-unique key (LibraryCategory.nameEn, ItemLibrary.code+scope)
// -----------------------------------------------------------------------------
async function upsertLibraryCategory(input: {
  nameEn: string;
  nameAr: string;
  sortOrder: number;
}) {
  const existing = await db.libraryCategory.findFirst({
    where: { nameEn: input.nameEn },
  });
  if (existing) {
    return db.libraryCategory.update({
      where: { id: existing.id },
      data: { nameAr: input.nameAr, sortOrder: input.sortOrder },
    });
  }
  return db.libraryCategory.create({ data: input });
}

async function upsertLibraryItem(input: {
  code: string;
  scope: "APP_GLOBAL";
  categoryId: string | null;
  descriptionEn: string;
  descriptionAr: string | null;
  unitId: string | null;
  defaultSpecsEn?: string | null;
  defaultSpecsAr?: string | null;
}) {
  const existing = await db.itemLibrary.findFirst({
    where: { code: input.code, scope: input.scope },
  });
  if (existing) {
    return db.itemLibrary.update({
      where: { id: existing.id },
      data: {
        categoryId: input.categoryId,
        descriptionEn: input.descriptionEn,
        descriptionAr: input.descriptionAr,
        unitId: input.unitId,
        defaultSpecsEn: input.defaultSpecsEn ?? null,
        defaultSpecsAr: input.defaultSpecsAr ?? null,
      },
    });
  }
  return db.itemLibrary.create({ data: input });
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------
async function main() {
  console.log("→ Seeding TechOffice reference data…");

  // 1. Units — upsert by code (@unique)
  const units = await Promise.all(
    UNITS.map((u) =>
      db.unit.upsert({
        where: { code: u.code },
        update: { nameEn: u.nameEn, nameAr: u.nameAr, defaultPrecision: u.defaultPrecision },
        create: { ...u },
      }),
    ),
  );
  const unitByCode = new Map(units.map((u) => [u.code, u]));

  // 2. Unit aliases — upsert by alias (@unique)
  let aliasCount = 0;
  for (const [unitCode, aliases] of Object.entries(UNIT_ALIASES)) {
    const unit = unitByCode.get(unitCode);
    if (!unit) {
      throw new Error(`Unit code "${unitCode}" not found while seeding aliases`);
    }
    await Promise.all(
      aliases.map((alias) =>
        db.unitAlias.upsert({
          where: { alias },
          update: { unitId: unit.id },
          create: { alias, unitId: unit.id },
        }),
      ),
    );
    aliasCount += aliases.length;
  }

  // 3. Rebar diameters — upsert by diameterMm (@unique)
  await Promise.all(
    REBAR_DIAMETERS.map((r) =>
      db.rebarDiameter.upsert({
        where: { diameterMm: r.diameterMm },
        update: { weightKgPerM: r.weightKgPerM },
        create: { ...r },
      }),
    ),
  );

  // 4. Shape codes — upsert by code (@unique)
  await Promise.all(
    SHAPE_CODES.map((s) =>
      db.shapeCode.upsert({
        where: { code: s.code },
        update: { nameEn: s.nameEn, nameAr: s.nameAr },
        create: { ...s },
      }),
    ),
  );

  // 5. Library categories — upsert by nameEn (findFirst-based helper)
  const categories = await Promise.all(
    LIBRARY_CATEGORIES.map((c) => upsertLibraryCategory({ ...c })),
  );
  const categoryByNameEn = new Map(categories.map((c) => [c.nameEn, c]));

  // 6. Library items — upsert by code+scope (findFirst-based helper)
  for (const item of LIBRARY_ITEMS) {
    const category = categoryByNameEn.get(item.categoryNameEn);
    if (!category) {
      throw new Error(
        `Library category "${item.categoryNameEn}" not found for item ${item.code}`,
      );
    }
    const unit = unitByCode.get(item.unitCode);
    if (!unit) {
      throw new Error(`Unit code "${item.unitCode}" not found for item ${item.code}`);
    }
    await upsertLibraryItem({
      code: item.code,
      scope: "APP_GLOBAL",
      categoryId: category.id,
      descriptionEn: item.descriptionEn,
      descriptionAr: item.descriptionAr,
      unitId: unit.id,
      defaultSpecsEn: item.defaultSpecsEn ?? null,
      defaultSpecsAr: item.defaultSpecsAr ?? null,
    });
  }

  console.log(
    `Seeded: ${UNITS.length} units, ${aliasCount} unit aliases, ` +
      `${REBAR_DIAMETERS.length} rebar diameters, ${SHAPE_CODES.length} shape codes, ` +
      `${LIBRARY_CATEGORIES.length} library categories, ${LIBRARY_ITEMS.length} library items.`,
  );
}

main()
  .catch((err) => {
    console.error("✗ Seed failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
