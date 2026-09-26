/**
 * The Orchard catalog. Orchard is a fictional brand; every product, rating and review here is made up
 * for the demo. Money is integer pence (GBP), as in Darwin.
 */

export type DeviceKind = "phone" | "laptop" | "watch" | "buds" | "tablet" | "case" | "charger" | "cable";

export interface Colour {
  name: string;
  hex: string;
}

export interface OptionChoice {
  name: string;
  /** Price on top of the base price, pence. */
  delta: number;
  note?: string;
}

export interface Feature {
  eyebrow: string;
  title: string;
  body: string;
}

export interface Review {
  author: string;
  rating: number;
  title: string;
  body: string;
}

export interface Product {
  slug: string;
  name: string;
  short: string;
  kind: DeviceKind;
  tagline: string;
  /** Base price, pence. */
  price: number;
  colours: Colour[];
  option?: { label: string; choices: OptionChoice[] };
  rating: number;
  reviews: number;
  /** 1 = best seller. */
  bestseller: number;
  isNew?: boolean;
  /** Units left per colour (used for low-stock urgency and the agent catalog). */
  stock: Record<string, number>;
  /** The long marketing story on the product page. */
  features: Feature[];
  specs: [string, string][];
  /** Size guide rows (label, detail). */
  sizeGuide?: [string, string][];
  accessory?: boolean;
}

/** Standard delivery, pence. Shown in the bag or only at the last checkout step, depending on the spec. */
export const DELIVERY_FEE = 995;
/** Free returns window, days. */
export const RETURNS_DAYS = 14;

export const PRODUCTS: Product[] = [
  {
    slug: "orchard-phone-17-pro",
    name: "Orchard Phone 17 Pro",
    short: "Phone 17 Pro",
    kind: "phone",
    tagline: "Pro, all the way through.",
    price: 109900,
    colours: [
      { name: "Ember", hex: "#b4532f" },
      { name: "Deep Sea", hex: "#2d3f58" },
      { name: "Silver", hex: "#d6d6d3" },
    ],
    option: {
      label: "Storage",
      choices: [
        { name: "256GB", delta: 0 },
        { name: "512GB", delta: 20000 },
        { name: "1TB", delta: 40000 },
      ],
    },
    rating: 4.8,
    reviews: 2184,
    bestseller: 1,
    isNew: true,
    stock: { Ember: 3, "Deep Sea": 14, Silver: 22 },
    features: [
      { eyebrow: "Design", title: "A titanium frame that shrugs off everyday life.", body: "A single piece of aerospace-grade titanium wraps the edge, so the whole phone is lighter than last year and tougher where it counts. The matte glass back resists fingerprints and comes in three new finishes." },
      { eyebrow: "Camera", title: "Three 48MP cameras. One very steady hand.", body: "Main, ultra-wide and a new 5x telephoto all shoot at 48 megapixels. Sensor-shift stabilisation keeps night shots crisp, and video records in 4K at 120 fps with studio-quality microphones." },
      { eyebrow: "Performance", title: "The O5 Pro chip. Fast now, fast in five years.", body: "A 6-core CPU and 6-core GPU with hardware ray tracing make games look console-grade, while the efficiency cores stretch battery life to a full day and a bit more." },
      { eyebrow: "Battery", title: "Up to 33 hours of video playback.", body: "A bigger cell and a smarter display that drops to 1Hz when nothing moves. Charge to 50% in about 20 minutes with a 35W adapter." },
      { eyebrow: "Durability", title: "Ceramic Shield front. IP68 water resistance.", body: "Dropped, splashed or dunked to 6 metres for 30 minutes, it keeps going. The front glass is harder than any glass we have used before." },
    ],
    specs: [
      ["Display", "6.3″ OLED, 120Hz, 3000 nits peak"],
      ["Chip", "O5 Pro, 6-core CPU, 6-core GPU"],
      ["Cameras", "48MP main, 48MP ultra-wide, 48MP 5x telephoto"],
      ["Battery", "Up to 33 hours video playback"],
      ["Weight", "199 g"],
      ["Connector", "USB-C (USB 3, 10Gb/s)"],
    ],
    sizeGuide: [
      ["Orchard Phone 17 Pro", "6.3″ display · 146.6 × 71.5 mm · 199 g"],
      ["Orchard Phone 17", "6.1″ display · 147.6 × 71.6 mm · 170 g"],
    ],
  },
  {
    slug: "orchard-phone-17",
    name: "Orchard Phone 17",
    short: "Phone 17",
    kind: "phone",
    tagline: "Bright colours. Brilliant everything.",
    price: 79900,
    colours: [
      { name: "Sage", hex: "#a9bf9c" },
      { name: "Mist", hex: "#c9d6e3" },
      { name: "Lilac", hex: "#cbbfe0" },
      { name: "Graphite", hex: "#2e2f33" },
    ],
    option: {
      label: "Storage",
      choices: [
        { name: "128GB", delta: 0 },
        { name: "256GB", delta: 10000 },
        { name: "512GB", delta: 30000 },
      ],
    },
    rating: 4.7,
    reviews: 3902,
    bestseller: 2,
    isNew: true,
    stock: { Sage: 18, Mist: 4, Lilac: 25, Graphite: 30 },
    features: [
      { eyebrow: "Design", title: "Colour-infused glass, all the way through.", body: "The colour is fused into the back glass itself, so it never chips or fades. An aluminium frame keeps it light." },
      { eyebrow: "Camera", title: "A 48MP main camera with a 2x optical-quality zoom.", body: "Take portraits, food and everything in between with a camera that picks the right lens for you." },
      { eyebrow: "Battery", title: "All-day battery, and then some.", body: "Up to 26 hours of video playback, with fast charging over USB-C." },
    ],
    specs: [
      ["Display", "6.1″ OLED, 60Hz"],
      ["Chip", "O5, 6-core CPU"],
      ["Cameras", "48MP main, 12MP ultra-wide"],
      ["Battery", "Up to 26 hours video playback"],
      ["Weight", "170 g"],
    ],
    sizeGuide: [
      ["Orchard Phone 17", "6.1″ display · 147.6 × 71.6 mm · 170 g"],
      ["Orchard Phone 17 Pro", "6.3″ display · 146.6 × 71.5 mm · 199 g"],
    ],
  },
  {
    slug: "orchard-book-air",
    name: "Orchard Book Air 13″",
    short: "Book Air",
    kind: "laptop",
    tagline: "Featherweight. Heavyweight speed.",
    price: 109900,
    colours: [
      { name: "Sky", hex: "#b7cbe0" },
      { name: "Silver", hex: "#d8d9db" },
      { name: "Graphite", hex: "#45464b" },
    ],
    option: {
      label: "Memory",
      choices: [
        { name: "16GB", delta: 0 },
        { name: "24GB", delta: 20000 },
        { name: "32GB", delta: 40000 },
      ],
    },
    rating: 4.8,
    reviews: 1240,
    bestseller: 3,
    stock: { Sky: 9, Silver: 16, Graphite: 11 },
    features: [
      { eyebrow: "Design", title: "1.1 cm thin. 1.2 kg light.", body: "A fanless aluminium unibody that fits in any bag and stays silent under load." },
      { eyebrow: "Display", title: "A 13.6″ display with a billion colours.", body: "500 nits of brightness and wide colour make photos look true to life, indoors or out." },
      { eyebrow: "Battery", title: "Up to 18 hours on one charge.", body: "Leave the charger at home. Seriously." },
    ],
    specs: [
      ["Display", "13.6″ Liquid display, 500 nits"],
      ["Chip", "O5 with 10-core CPU and 8-core GPU"],
      ["Battery", "Up to 18 hours"],
      ["Weight", "1.24 kg"],
      ["Ports", "2 × USB-C, MagCharge, headphone jack"],
    ],
    sizeGuide: [
      ["13″ model", "30.4 × 21.5 × 1.13 cm · 1.24 kg"],
      ["15″ model (coming soon)", "34.0 × 23.8 × 1.15 cm · 1.51 kg"],
    ],
  },
  {
    slug: "orchard-watch-11",
    name: "Orchard Watch Series 11",
    short: "Watch Series 11",
    kind: "watch",
    tagline: "Your health, right on your wrist.",
    price: 39900,
    colours: [
      { name: "Rose", hex: "#e3bcb6" },
      { name: "Jet", hex: "#26272a" },
      { name: "Silver", hex: "#d4d5d7" },
    ],
    option: {
      label: "Case size",
      choices: [
        { name: "42mm", delta: 0, note: "Fits 130–200 mm wrists" },
        { name: "46mm", delta: 3000, note: "Fits 140–245 mm wrists" },
      ],
    },
    rating: 4.6,
    reviews: 1511,
    bestseller: 4,
    isNew: true,
    stock: { Rose: 6, Jet: 2, Silver: 13 },
    features: [
      { eyebrow: "Health", title: "Sleep score, heart rhythm and more.", body: "Wake up to a sleep score, get notified about irregular rhythms and track your training load over weeks." },
      { eyebrow: "Display", title: "A wider-angle display you can read at a glance.", body: "Brighter from the side, and it shows the time even when your wrist is down." },
      { eyebrow: "Battery", title: "Up to 24 hours. 36 in low-power mode.", body: "Fast charge to 80% in about 30 minutes." },
    ],
    specs: [
      ["Case", "42mm or 46mm aluminium"],
      ["Display", "Always-on wide-angle OLED"],
      ["Water resistance", "50 m"],
      ["Battery", "Up to 24 hours"],
    ],
    sizeGuide: [
      ["42mm case", "Fits 130–200 mm wrists · 30 g"],
      ["46mm case", "Fits 140–245 mm wrists · 35 g"],
      ["How to measure", "Wrap a strip of paper round your wrist just below the bone and measure it."],
    ],
  },
  {
    slug: "orchard-buds-pro",
    name: "Orchard Buds Pro 3",
    short: "Buds Pro 3",
    kind: "buds",
    tagline: "Quiet the world. Hear the music.",
    price: 22900,
    colours: [{ name: "White", hex: "#f2f2f2" }],
    rating: 4.7,
    reviews: 5420,
    bestseller: 5,
    stock: { White: 40 },
    features: [
      { eyebrow: "Sound", title: "Twice the noise cancellation.", body: "New microphones and a faster chip cancel the rumble of a train and the hum of an office." },
      { eyebrow: "Fit", title: "Five ear-tip sizes, one perfect seal.", body: "A fit test tells you which tip seals best." },
    ],
    specs: [
      ["Battery", "Up to 8 hours (30 with case)"],
      ["Water resistance", "IP57"],
      ["Charging", "USB-C, wireless"],
    ],
    sizeGuide: [
      ["Ear tips", "XXS, XS, S, M, L included"],
      ["Case", "4.7 × 6.1 × 2.1 cm · 43 g"],
    ],
  },
  {
    slug: "orchard-pad-air",
    name: "Orchard Pad Air",
    short: "Pad Air",
    kind: "tablet",
    tagline: "Big screen. Small bag.",
    price: 59900,
    colours: [
      { name: "Space", hex: "#4a4b50" },
      { name: "Blue", hex: "#a6bbd3" },
      { name: "Violet", hex: "#c8bde0" },
    ],
    option: {
      label: "Size",
      choices: [
        { name: "11-inch", delta: 0 },
        { name: "13-inch", delta: 20000 },
      ],
    },
    rating: 4.7,
    reviews: 980,
    bestseller: 6,
    stock: { Space: 12, Blue: 5, Violet: 8 },
    features: [
      { eyebrow: "Display", title: "Liquid display in two sizes.", body: "An 11-inch or 13-inch display with true colour and anti-reflective coating." },
      { eyebrow: "Performance", title: "The O5 chip. Laptop-class power.", body: "Edit video, sketch with the Orchard Pencil and run pro apps without breaking a sweat." },
    ],
    specs: [
      ["Display", "11″ or 13″ Liquid display"],
      ["Chip", "O5"],
      ["Battery", "Up to 10 hours"],
    ],
    sizeGuide: [
      ["11-inch", "24.8 × 17.9 cm · 460 g"],
      ["13-inch", "28.1 × 21.5 cm · 617 g"],
    ],
  },
  {
    slug: "orchard-clear-case",
    name: "Clear Case for Phone 17 Pro",
    short: "Clear Case",
    kind: "case",
    tagline: "Show off the finish. Protect the phone.",
    price: 4900,
    colours: [{ name: "Clear", hex: "#e9eef3" }],
    rating: 4.4,
    reviews: 620,
    bestseller: 7,
    stock: { Clear: 60 },
    features: [{ eyebrow: "Case", title: "Thin, clear and scratch resistant.", body: "Made from optically clear polycarbonate with built-in magnets for snap-on chargers." }],
    specs: [["Material", "Polycarbonate and flexible TPU"]],
    accessory: true,
  },
  {
    slug: "orchard-35w-charger",
    name: "35W Dual USB-C Charger",
    short: "35W Charger",
    kind: "charger",
    tagline: "Two devices. One compact plug.",
    price: 5900,
    colours: [{ name: "White", hex: "#f4f4f4" }],
    rating: 4.5,
    reviews: 410,
    bestseller: 8,
    stock: { White: 45 },
    features: [{ eyebrow: "Charger", title: "Charge a phone and a watch at once.", body: "Folding UK pins, two USB-C ports and 35W shared between them." }],
    specs: [["Output", "35W total, 2 × USB-C"]],
    accessory: true,
  },
  {
    slug: "orchard-braided-cable",
    name: "USB-C Braided Cable (1 m)",
    short: "Braided Cable",
    kind: "cable",
    tagline: "The one cable you'll keep.",
    price: 1900,
    colours: [{ name: "White", hex: "#f4f4f4" }],
    rating: 4.6,
    reviews: 1310,
    bestseller: 9,
    stock: { White: 120 },
    features: [{ eyebrow: "Cable", title: "Woven to last.", body: "A braided design that resists tangles, rated for 60W charging." }],
    specs: [["Length", "1 m"], ["Power", "Up to 60W"]],
    accessory: true,
  },
];

export const BY_SLUG = new Map(PRODUCTS.map((p) => [p.slug, p]));

export function getProduct(slug: string): Product | undefined {
  return BY_SLUG.get(slug);
}

/** What shows on the home/store grid: devices plus the two best-selling accessories. */
export const GRID_PRODUCTS = PRODUCTS.filter((p) => p.slug !== "orchard-braided-cable");

export const UPSELL_SLUGS = ["orchard-clear-case", "orchard-35w-charger", "orchard-braided-cable"];

export function sortProducts(products: Product[], sort: "featured" | "bestselling" | "price-asc" | "rating"): Product[] {
  const list = [...products];
  if (sort === "bestselling") list.sort((a, b) => a.bestseller - b.bestseller);
  else if (sort === "price-asc") list.sort((a, b) => a.price - b.price);
  else if (sort === "rating") list.sort((a, b) => b.rating - a.rating || b.reviews - a.reviews);
  else {
    // "Featured": the merchandiser's pick. Leads with the new watch and accessories, flagship last.
    const order = ["orchard-watch-11", "orchard-clear-case", "orchard-pad-air", "orchard-35w-charger", "orchard-buds-pro", "orchard-book-air", "orchard-phone-17", "orchard-phone-17-pro"];
    list.sort((a, b) => order.indexOf(a.slug) - order.indexOf(b.slug));
  }
  return list;
}

export function unitPrice(p: Product, option?: string): number {
  const choice = p.option?.choices.find((c) => c.name === option);
  return p.price + (choice?.delta ?? 0);
}

export const fromPrice = (p: Product) => p.price;

/** Illustrative review snippets (fictional). */
export const REVIEW_SNIPPETS: Review[] = [
  { author: "Priya S., Leeds", rating: 5, title: "Worth every penny", body: "Battery easily lasts two days for me and the camera is ridiculous in low light." },
  { author: "Tom H., Bristol", rating: 5, title: "Arrived next day", body: "Ordered before 3pm, it was on my doorstep the next morning. Setup took five minutes." },
  { author: "Alex M., Glasgow", rating: 4, title: "Beautiful finish", body: "Lighter than my old phone. Wish the charger was in the box, but the build quality is superb." },
];
