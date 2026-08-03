/**
 * Seed data for DilKhush Dhaba – Raita Wala.
 * ⚠️ ALL addresses, coordinates, phone numbers and staff credentials below are
 * PLACEHOLDERS. Replace them from the owner dashboard / env before production.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const db = new PrismaClient();

async function main() {
  console.log("🌱 Seeding DilKhush Dhaba…");

  // ---------------- branches (PLACEHOLDER coordinates & contacts)
  const rohini = await db.branch.upsert({
    where: { slug: "rohini" },
    update: {},
    create: {
      slug: "rohini",
      name: "DilKhush Dhaba – Rohini",
      address: "PLACEHOLDER: Shop 12, Sector 7 Market, Rohini, Delhi",
      pincode: "110085",
      lat: 28.7365, // PLACEHOLDER coords near Rohini
      lng: 77.112,
      phone: "+911100000001", // PLACEHOLDER
      deliveryRadiusKm: 7,
      serviceablePincodesJson: JSON.stringify(["110085", "110086", "110089", "110042"]),
      minOrderValue: 149,
      baseDeliveryFee: 30,
      perKmFee: 7,
      freeKm: 3,
      freeDeliveryAbove: 499,
      packagingFee: 15,
      taxPercent: 5,
      prepTimeMins: 25,
      maxActiveOrders: 30,
      hours: {
        create: Array.from({ length: 7 }, (_, d) => ({
          dayOfWeek: d,
          openTime: "11:00",
          closeTime: "23:00",
        })),
      },
    },
  });

  const nsp = await db.branch.upsert({
    where: { slug: "nsp" },
    update: {},
    create: {
      slug: "nsp",
      name: "DilKhush Dhaba – NSP",
      address: "PLACEHOLDER: Unit 4, Netaji Subhash Place, Pitampura, Delhi",
      pincode: "110034",
      lat: 28.6929, // PLACEHOLDER coords near NSP
      lng: 77.1512,
      phone: "+911100000002", // PLACEHOLDER
      deliveryRadiusKm: 6,
      serviceablePincodesJson: JSON.stringify(["110034", "110035", "110052", "110009"]),
      minOrderValue: 199,
      baseDeliveryFee: 35,
      perKmFee: 8,
      freeKm: 2.5,
      freeDeliveryAbove: 599,
      packagingFee: 20,
      taxPercent: 5,
      prepTimeMins: 30,
      maxActiveOrders: 25,
      hours: {
        create: Array.from({ length: 7 }, (_, d) => ({
          dayOfWeek: d,
          openTime: d === 1 ? "12:00" : "11:00", // Monday opens later
          closeTime: "23:30",
        })),
      },
    },
  });

  // ---------------- loyalty tiers (owner-editable defaults)
  const tierCount = await db.loyaltyTier.count();
  if (tierCount === 0) {
    await db.loyaltyTier.createMany({
      data: [
        { name: "New Customer", minCompletedOrders: 0, minLifetimeSpend: 0, pointMultiplier: 1, freeDelivery: false, discountPercent: 0, benefitsText: "Earn 1 point per ₹10 spent", sortOrder: 0 },
        { name: "Regular Customer", minCompletedOrders: 3, minLifetimeSpend: 750, pointMultiplier: 1.2, freeDelivery: false, discountPercent: 0, benefitsText: "20% faster point earning", sortOrder: 1 },
        { name: "Dhaba Lover", minCompletedOrders: 8, minLifetimeSpend: 2500, pointMultiplier: 1.5, freeDelivery: true, discountPercent: 0, benefitsText: "Free delivery + 1.5× points", sortOrder: 2 },
        { name: "DilKhush VIP", minCompletedOrders: 20, minLifetimeSpend: 8000, pointMultiplier: 2, freeDelivery: true, discountPercent: 5, benefitsText: "Free delivery, 2× points & 5% off every order", sortOrder: 3 },
      ],
    });
  }

  // ---------------- staff (TEST ACCOUNTS — change all passwords in production!)
  const pw = (p: string) => bcrypt.hashSync(p, 10);
  const staff: Array<[string, string, string, string, string[]]> = [
    // email, password, name, role, branch slugs
    ["owner@dilkhush.test", "Owner@123", "Om Prakash (Owner)", "OWNER", []],
    ["manager.rohini@dilkhush.test", "Manager@123", "Rekha (Rohini Manager)", "BRANCH_MANAGER", ["rohini"]],
    ["manager.nsp@dilkhush.test", "Manager@123", "Naveen (NSP Manager)", "BRANCH_MANAGER", ["nsp"]],
    ["kitchen.rohini@dilkhush.test", "Kitchen@123", "Kitchen Rohini", "KITCHEN", ["rohini"]],
    ["kitchen.nsp@dilkhush.test", "Kitchen@123", "Kitchen NSP", "KITCHEN", ["nsp"]],
    ["cashier.rohini@dilkhush.test", "Cashier@123", "Cashier Rohini", "CASHIER", ["rohini"]],
    ["delivery@dilkhush.test", "Delivery@123", "Dev (Delivery Manager)", "DELIVERY_MANAGER", []],
    ["marketing@dilkhush.test", "Market@123", "Meera (Marketing)", "MARKETING", []],
  ];
  const slugToId: Record<string, string> = { rohini: rohini.id, nsp: nsp.id };
  for (const [email, password, name, role, branches] of staff) {
    const u = await db.user.upsert({
      where: { email },
      update: {},
      create: { email, name, role, passwordHash: pw(password) },
    });
    for (const slug of branches) {
      await db.staffBranchAssignment.upsert({
        where: { userId_branchId: { userId: u.id, branchId: slugToId[slug] } },
        update: {},
        create: { userId: u.id, branchId: slugToId[slug] },
      });
    }
  }

  // Delivery agents (future activation; used for assignment now)
  for (const [phone, name] of [
    ["+919900000001", "Raju (Agent)"],
    ["+919900000002", "Sonu (Agent)"],
  ] as const) {
    const u = await db.user.upsert({
      where: { phone },
      update: {},
      create: { phone, name, role: "DELIVERY_AGENT" },
    });
    await db.deliveryAgent.upsert({
      where: { userId: u.id },
      update: {},
      create: { userId: u.id, online: true, vehicle: "Bike" },
    });
  }

  // Test customer (sign in with this number; OTP appears in the server console)
  await db.user.upsert({
    where: { phone: "+919899999999" },
    update: {},
    create: {
      phone: "+919899999999", // PLACEHOLDER test customer
      name: "Test Customer",
      role: "CUSTOMER",
      profile: { create: { referralCode: "DKTEST01" } },
      metrics: { create: {} },
    },
  });

  // ---------------- menu
  const cats = [
    "Recommended", "Bestsellers", "Starters", "Main Course", "Dal", "Paneer",
    "Thali", "Raita", "Breads", "Rice", "Beverages", "Desserts",
  ];
  const catId: Record<string, string> = {};
  for (let i = 0; i < cats.length; i++) {
    const slug = cats[i].toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const c = await db.category.upsert({
      where: { slug },
      update: {},
      create: { name: cats[i], slug, displayOrder: i },
    });
    catId[cats[i]] = c.id;
  }

  type ItemSeed = {
    cat: string; name: string; hindi?: string; desc: string; emoji: string; price: number;
    veg?: boolean; vegan?: boolean; spicy?: boolean; best?: boolean; rec?: boolean;
    prep?: number; ing?: string; all?: string;
    variants?: [string, number, boolean?][];
    addOns?: [string, number][];
    nspPrice?: number; nspOff?: boolean; window?: [string, string]; stock?: number;
  };

  const RAITA_ADDONS: [string, number][] = [["Extra Raita", 30], ["Extra Butter", 20], ["Add Salad", 25], ["Disposable Cutlery", 5]];
  const GRAVY_ADDONS: [string, number][] = [["Extra Gravy", 35], ["Extra Butter", 20], ["Extra Raita", 30], ["Add Salad", 25]];

  const items: ItemSeed[] = [
    { cat: "Dal", name: "Dal Makhani", hindi: "दाल मखनी", desc: "Black lentils simmered overnight with butter & cream — our signature.", emoji: "🍲", price: 249, best: true, rec: true, prep: 20, ing: "Urad dal, rajma, butter, cream, tomatoes", all: "Dairy", variants: [["Half", -70], ["Full", 0, true]], addOns: GRAVY_ADDONS },
    { cat: "Dal", name: "Dal Tadka", hindi: "दाल तड़का", desc: "Yellow dal with a sizzling ghee-garlic tadka.", emoji: "🥣", price: 199, vegan: false, prep: 15, variants: [["Half", -60], ["Full", 0, true]], addOns: RAITA_ADDONS },
    { cat: "Paneer", name: "Paneer Butter Masala", hindi: "पनीर बटर मसाला", desc: "Cottage cheese in silky tomato-butter gravy.", emoji: "🧀", price: 289, best: true, prep: 20, all: "Dairy, nuts", variants: [["Half", -80], ["Full", 0, true]], addOns: GRAVY_ADDONS, nspPrice: 299 },
    { cat: "Paneer", name: "Kadhai Paneer", desc: "Paneer tossed with peppers & fresh-ground kadhai masala.", emoji: "🫑", price: 279, spicy: true, prep: 22, addOns: GRAVY_ADDONS },
    { cat: "Paneer", name: "Palak Paneer", desc: "Paneer in slow-cooked spinach gravy.", emoji: "🥬", price: 259, prep: 20, addOns: GRAVY_ADDONS },
    { cat: "Starters", name: "Paneer Tikka", desc: "Char-grilled paneer with mint chutney.", emoji: "🍢", price: 269, spicy: true, best: true, prep: 25, all: "Dairy", addOns: [["Extra Mint Chutney", 15], ["Add Salad", 25]] },
    { cat: "Starters", name: "Veg Seekh Kebab", desc: "Smoky vegetable kebabs from the tandoor.", emoji: "🥖", price: 229, vegan: true, prep: 25 },
    { cat: "Starters", name: "Chilli Paneer (Dry)", desc: "Indo-Chinese favourite, extra crisp.", emoji: "🌶️", price: 249, spicy: true, prep: 20 },
    { cat: "Main Course", name: "Chole Bhature", hindi: "छोले भटूरे", desc: "Fluffy bhature with spicy Punjabi chole. Morning special!", emoji: "🫓", price: 179, spicy: true, best: true, prep: 18, window: ["08:00", "16:00"], addOns: RAITA_ADDONS },
    { cat: "Main Course", name: "Rajma Chawal", desc: "Comforting rajma over steamed rice.", emoji: "🍛", price: 189, prep: 15, addOns: RAITA_ADDONS },
    { cat: "Main Course", name: "Kadhi Pakora", desc: "Tangy yogurt kadhi with fritters.", emoji: "🥘", price: 169, prep: 15, all: "Dairy, gluten" },
    { cat: "Main Course", name: "Mix Veg", desc: "Seasonal vegetables in home-style masala.", emoji: "🥗", price: 199, vegan: true, prep: 18 },
    { cat: "Thali", name: "DilKhush Special Thali", hindi: "स्पेशल थाली", desc: "Dal makhani, paneer, 3 rotis, rice, raita, salad & dessert.", emoji: "🍽️", price: 349, best: true, rec: true, prep: 25, addOns: [["Extra Roti", 20], ["Extra Raita", 30], ["Upgrade to Butter Roti", 15]], stock: 20 },
    { cat: "Thali", name: "Mini Thali", desc: "Dal, sabzi, 2 rotis, rice & raita — perfect lunch.", emoji: "🍱", price: 229, prep: 20, stock: 30 },
    { cat: "Raita", name: "Signature Mixed Raita", hindi: "रायता", desc: "The raita that named us — boondi, cucumber & secret masala.", emoji: "🥛", price: 89, best: true, rec: true, prep: 5, all: "Dairy", variants: [["Regular", 0, true], ["Large", 40]] },
    { cat: "Raita", name: "Boondi Raita", desc: "Classic crispy boondi raita.", emoji: "🥛", price: 69, prep: 5, all: "Dairy" },
    { cat: "Raita", name: "Pineapple Raita", desc: "Sweet & savoury, NSP exclusive.", emoji: "🍍", price: 99, prep: 5, all: "Dairy", nspOff: false },
    { cat: "Breads", name: "Butter Tandoori Roti", desc: "Whole-wheat, brushed with white butter.", emoji: "🫓", price: 25, prep: 8, all: "Gluten, dairy" },
    { cat: "Breads", name: "Garlic Naan", desc: "Leavened naan with roasted garlic.", emoji: "🧄", price: 65, prep: 10, all: "Gluten, dairy", best: true },
    { cat: "Breads", name: "Lachha Paratha", desc: "Flaky layered paratha.", emoji: "🥞", price: 55, prep: 10, all: "Gluten" },
    { cat: "Rice", name: "Jeera Rice", desc: "Basmati tossed with cumin & ghee.", emoji: "🍚", price: 149, prep: 12 },
    { cat: "Rice", name: "Veg Biryani", desc: "Fragrant dum biryani with raita.", emoji: "🍛", price: 249, spicy: true, prep: 25, addOns: [["Extra Raita", 30]] },
    { cat: "Beverages", name: "Sweet Lassi", desc: "Thick punjabi lassi in a kulhad.", emoji: "🥤", price: 89, prep: 5, all: "Dairy", variants: [["Regular", 0, true], ["Large", 30]] },
    { cat: "Beverages", name: "Masala Chaas", desc: "Spiced buttermilk — great with thali.", emoji: "🧋", price: 59, prep: 5, all: "Dairy" },
    { cat: "Beverages", name: "Masala Chai", desc: "Dhaba-style kadak chai.", emoji: "☕", price: 39, prep: 8, all: "Dairy" },
    { cat: "Desserts", name: "Gulab Jamun (2 pc)", desc: "Warm, soaked in saffron syrup.", emoji: "🍮", price: 79, prep: 5, all: "Dairy, gluten" },
    { cat: "Desserts", name: "Gajar Halwa", desc: "Winter special, slow-cooked with khoya.", emoji: "🥕", price: 119, prep: 8, all: "Dairy, nuts", stock: 15 },
  ];

  for (let i = 0; i < items.length; i++) {
    const s = items[i];
    const existing = await db.menuItem.findFirst({ where: { name: s.name } });
    if (existing) continue;
    const item = await db.menuItem.create({
      data: {
        categoryId: catId[s.cat],
        name: s.name,
        nameHindi: s.hindi ?? null,
        description: s.desc,
        imageEmoji: s.emoji, // PLACEHOLDER — replace with real food photos (imageUrl)
        basePrice: s.price,
        veg: s.veg ?? true,
        vegan: s.vegan ?? false,
        spicy: s.spicy ?? false,
        bestseller: s.best ?? false,
        recommended: s.rec ?? false,
        prepTimeMins: s.prep ?? 20,
        ingredients: s.ing ?? "",
        allergens: s.all ?? "",
        displayOrder: i,
        variants: {
          create: (s.variants ?? []).map(([name, priceDelta, isDefault]) => ({
            name, priceDelta, isDefault: isDefault ?? false,
          })),
        },
        addOns: { create: (s.addOns ?? []).map(([name, price]) => ({ name, price })) },
      },
    });
    // Branch links: Rohini gets everything; NSP demonstrates overrides.
    await db.branchMenuItem.create({
      data: {
        branchId: rohini.id,
        menuItemId: item.id,
        stockQty: s.stock ?? -1,
        availableFrom: s.window?.[0] ?? null,
        availableTo: s.window?.[1] ?? null,
        available: s.name !== "Pineapple Raita", // Pineapple raita is NSP-only
      },
    });
    await db.branchMenuItem.create({
      data: {
        branchId: nsp.id,
        menuItemId: item.id,
        priceOverride: s.nspPrice ?? null,
        stockQty: s.stock ?? -1,
        availableFrom: s.window?.[0] ?? null,
        availableTo: s.window?.[1] ?? null,
        available: s.nspOff === undefined ? true : !s.nspOff,
      },
    });
  }

  // Copy "Recommended"/"Bestsellers" listing categories: items already flagged.
  // ---------------- coupons
  const coupons = [
    {
      code: "WELCOME50", name: "50% off your first order", description: "New to DilKhush? Get 50% off up to ₹120 on your first order.",
      rewardType: "PERCENT", value: 50, maxDiscount: 120, minCartValue: 199,
      firstOrderOnly: true, perCustomerLimit: 1, autoApply: true, priority: 10,
    },
    {
      code: "DILKHUSH20", name: "20% off on ₹499+", description: "Flat 20% off up to ₹150 on orders above ₹499.",
      rewardType: "PERCENT", value: 20, maxDiscount: 150, minCartValue: 499,
      perCustomerLimit: 10, autoApply: false, priority: 5,
    },
    {
      code: "FREEDEL", name: "Free delivery on ₹299+", description: "No delivery fee on orders above ₹299.",
      rewardType: "FREE_DELIVERY", value: 0, minCartValue: 299,
      perCustomerLimit: 20, autoApply: false, priority: 1,
      orderTypesJson: JSON.stringify(["DELIVERY"]),
    },
    {
      code: "COMEBACK100", name: "₹100 welcome-back treat", description: "Missed you! ₹100 off if you haven't ordered in 30 days.",
      rewardType: "FLAT", value: 100, minCartValue: 349, inactiveDays: 30,
      perCustomerLimit: 3, autoApply: true, priority: 8,
    },
  ];
  for (const c of coupons) {
    await db.coupon.upsert({
      where: { code: c.code },
      update: {},
      create: {
        ...c,
        orderTypesJson: (c as { orderTypesJson?: string }).orderTypesJson ?? JSON.stringify(["DELIVERY", "PICKUP"]),
      },
    });
  }

  console.log("✅ Seed complete.");
  console.log("   Staff logins (all PLACEHOLDER — change in production):");
  for (const [email, password, , role] of staff) console.log(`   ${role.padEnd(17)} ${email} / ${password}`);
  console.log("   Test customer phone: +91 98999 99999 (OTP prints to this console)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
