import type { AssetClass } from "@prisma/client";

/**
 * Phase 43 (spec §3, §7): the scale seed's fictional vocabulary — names, clients, titles and models. Any likeness
 * to a real company or person is accidental. Prices are rough pesos, enough for book value to have data.
 */

export const FIRST_NAMES = [
  "Andrea", "Bea", "Carmela", "Danica", "Elaine", "Francine", "Gia", "Hazel", "Isabel", "Jasmine",
  "Kristine", "Lovely", "Mae", "Nicole", "Patricia", "Queenie", "Rhea", "Sheila", "Trisha", "Venus",
  "Aaron", "Benjo", "Christian", "Dominic", "Edgar", "Francis", "Gabriel", "Hector", "Ivan", "Jerome",
  "Kenneth", "Lance", "Mark", "Nathaniel", "Oliver", "Paolo", "Rafael", "Samuel", "Tristan", "Vincent",
  "Arvin", "Bryan", "Cyrus", "Darwin", "Emman", "Fritz", "Gerald", "Jomar", "Kevin", "Lester",
  "Angeline", "Bianca", "Camille", "Diane", "Erika", "Faith", "Grace", "Hannah", "Irene", "Joanna",
] as const;

export const LAST_NAMES = [
  "Abad", "Aquino", "Bautista", "Bernardo", "Castillo", "Cruz", "Dela Cruz", "Del Rosario", "Domingo", "Espiritu",
  "Fernandez", "Flores", "Garcia", "Gonzales", "Hernandez", "Ignacio", "Jimenez", "Lazaro", "Lopez", "Macaraeg",
  "Manalo", "Mendoza", "Navarro", "Ocampo", "Pascual", "Perez", "Quiambao", "Ramos", "Reyes", "Rivera",
  "Salazar", "Santiago", "Santos", "Tolentino", "Torres", "Valdez", "Velasco", "Villanueva", "Yap", "Zamora",
  "Agustin", "Buenaventura", "Cabrera", "Dizon", "Estrada", "Gatchalian", "Lacson", "Marquez", "Pineda", "Soriano",
] as const;

/** The three internal teams the scale seed adds to the normal seed's five (spec §3: about 8 internal teams). */
export const NEW_INTERNAL_DEPARTMENTS = ["Quality Assurance", "Workforce Management", "Recruitment"] as const;

/** 38 fictional clients; with the normal seed's Bluepeak Telecom and Harborline Billing that makes 40. */
export const NEW_CLIENTS = [
  "Aster Home Lending", "Brightwave Utilities", "Cedar and Pine Insurance", "Coralstone Health", "Driftwood Travel",
  "Emberline Energy", "Fairhaven Logistics", "Foxglove Retail", "Granite Ridge Savings", "Halcyon Fitness",
  "Ironbark Security", "Juniper Learning", "Kestrel Mortgage", "Lakeshore Medical Billing", "Larkspur Apparel",
  "Meridian Auto Care", "Mistral Air Support", "Northgate Property", "Oakhurst Legal", "Orchid Telehealth",
  "Pinecrest Pharmacy", "Quarry Lane Media", "Redfern Solar", "Riverbend Credit", "Saltmarsh Seafoods",
  "Silverleaf Wellness", "Stonebridge Payroll", "Summit Ridge Realty", "Tidewater Shipping", "Timberline Outfitters",
  "Umbra Games", "Valemont Hotels", "Westbrook Pet Supply", "Willowmere Dental", "Yarrow Subscriptions",
  "Zephyr Broadband", "Copperfield Collections", "Moonstone Ecommerce",
] as const;

/** Internal headcount per team (170 in all); the rest of the 590 are client staff (spec §3: about 70 %). */
export const INTERNAL_HEADCOUNT: Record<string, number> = {
  Operations: 40, "Quality Assurance": 30, "Workforce Management": 21, Recruitment: 20,
  Sales: 20, HR: 15, IT: 12, Finance: 12,
};

export const INTERNAL_TITLES: Record<string, readonly string[]> = {
  Operations: ["Operations Supervisor", "Operations Manager", "Ops Coordinator", "Site Lead"],
  "Quality Assurance": ["Quality Analyst", "QA Specialist", "QA Team Lead"],
  "Workforce Management": ["Workforce Analyst", "Real-time Analyst", "Scheduler"],
  Recruitment: ["Recruiter", "Talent Sourcer", "Recruitment Lead"],
  Sales: ["Account Executive", "Sales Associate", "Business Development Manager"],
  HR: ["HR Generalist", "Payroll Specialist", "HR Business Partner"],
  IT: ["IT Support", "Systems Administrator", "Network Engineer"],
  Finance: ["Accountant", "Bookkeeper", "Financial Analyst"],
};

export const CLIENT_TITLES: ReadonlyArray<readonly [string, number]> = [
  ["Customer Service Representative", 8], ["Technical Support Specialist", 4], ["Chat Support Agent", 3],
  ["Billing Specialist", 2], ["Back Office Associate", 2], ["Sales Representative", 1],
  ["Team Leader", 1], ["Quality Analyst", 1],
];

export interface ModelSpec { model: string; brand: string; cost: number }
export interface CategorySpec {
  cls: AssetClass;
  /** new assets of this category (spec §3: about 900 IT and 100 Purchasing in all) */
  count: number;
  /** tag prefix per type name ("*" = every type) */
  prefix: Record<string, string>;
  warrantyMonths: number | null;
  /** type name → its models */
  types: Record<string, readonly ModelSpec[]>;
  /** cheap enough that Finance usually approves it as not capitalised */
  lowValue?: boolean;
  serial?: boolean;
}

const m = (model: string, brand: string, cost: number): ModelSpec => ({ model, brand, cost });

export const CATEGORY_SPECS: Record<string, CategorySpec> = {
  Laptop: { cls: "IT", count: 255, prefix: { "*": "LT" }, warrantyMonths: 36, serial: true, types: {
    Standard: [m("Dell Latitude 5440", "Dell", 58_000), m("ThinkPad T14 Gen 4", "Lenovo", 65_000), m("HP ProBook 450 G10", "HP", 52_000), m("ThinkPad E14 Gen 5", "Lenovo", 45_000)],
    "High-performance": [m("Dell Precision 3581", "Dell", 110_000), m("ThinkPad P16s Gen 2", "Lenovo", 120_000)],
    MacBook: [m("MacBook Air M2", "Apple", 70_000), m("MacBook Pro 14 M3", "Apple", 120_000)],
  } },
  "Workstation (PC)": { cls: "IT", count: 200, prefix: { "*": "WS" }, warrantyMonths: 36, serial: true, types: {
    "Desktop tower": [m("Dell OptiPlex 7010 Tower", "Dell", 42_000), m("HP Pro Tower 400 G9", "HP", 38_000)],
    "Mini PC": [m("ThinkCentre M70q Gen 4", "Lenovo", 36_000), m("Dell OptiPlex 7010 Micro", "Dell", 40_000)],
    "All-in-one": [m("HP ProOne 440 G9", "HP", 55_000)],
  } },
  Monitor: { cls: "IT", count: 80, prefix: { "*": "MN" }, warrantyMonths: 36, serial: true, types: {
    "24-inch": [m("Dell P2422H", "Dell", 9_500), m("LG 24MP400", "LG", 6_500), m("Samsung S24C310", "Samsung", 6_000)],
    "27-inch": [m("Dell P2723D", "Dell", 16_000), m("LG 27UL500", "LG", 12_000)],
  } },
  Headset: { cls: "IT", count: 245, prefix: { "*": "HS" }, warrantyMonths: 24, serial: true, types: {
    Wired: [m("Jabra Evolve2 30", "Jabra", 3_800), m("Logitech H390", "Logitech", 1_800), m("Poly Blackwire 3220", "Poly", 3_200)],
    Wireless: [m("Jabra Evolve2 65", "Jabra", 9_000), m("Logitech Zone Vibe 100", "Logitech", 6_000)],
  } },
  Mouse: { cls: "IT", count: 20, prefix: { "*": "MS" }, warrantyMonths: 12, lowValue: true, types: {
    Wired: [m("Logitech B100", "Logitech", 350)],
    Wireless: [m("Logitech M331", "Logitech", 900), m("Logitech MX Anywhere 3", "Logitech", 3_500)],
  } },
  Keyboard: { cls: "IT", count: 15, prefix: { "*": "KB" }, warrantyMonths: 12, lowValue: true, types: {
    Wired: [m("Logitech K120", "Logitech", 500)],
    Wireless: [m("Logitech MK270", "Logitech", 1_500), m("Logitech MX Keys", "Logitech", 6_000)],
  } },
  Webcam: { cls: "IT", count: 10, prefix: { "*": "WC" }, warrantyMonths: 24, serial: true, types: {
    "USB webcam": [m("Logitech C920", "Logitech", 4_000)],
    "Conference camera": [m("Logitech MeetUp", "Logitech", 55_000)],
  } },
  UPS: { cls: "IT", count: 10, prefix: { "*": "UP" }, warrantyMonths: 24, serial: true, types: {
    "Desktop UPS": [m("APC Back-UPS 650VA", "APC", 3_500)],
    "Rack UPS": [m("APC Smart-UPS 1500VA", "APC", 45_000)],
  } },
  "Windows License": { cls: "IT", count: 10, prefix: { "*": "WL" }, warrantyMonths: null, types: {
    OEM: [m("Windows 11 Pro OEM", "Microsoft", 8_000)],
    Retail: [m("Windows 11 Pro Retail", "Microsoft", 12_000)],
    Volume: [m("Windows 11 Pro Volume", "Microsoft", 9_000)],
  } },
  "Laptop Bag": { cls: "IT", count: 10, prefix: { "*": "BG" }, warrantyMonths: null, lowValue: true, types: {
    Backpack: [m("Targus Classic Backpack", "Targus", 1_600)],
    Sleeve: [m("Targus 14-inch Sleeve", "Targus", 800)],
  } },
  Other: { cls: "IT", count: 20, prefix: { Phone: "PH", Speaker: "SP", Printer: "PR", "Docking Station": "DK", "Type C Hub": "HB" }, warrantyMonths: 12, serial: true, types: {
    Phone: [m("Samsung Galaxy A54", "Samsung", 18_000), m("iPhone 13", "Apple", 32_000)],
    Speaker: [m("Jabra Speak 510", "Jabra", 6_000)],
    Printer: [m("Brother HL-L2350DW", "Brother", 8_000), m("Epson L3210", "Epson", 9_000)],
    "Docking Station": [m("Dell WD19S", "Dell", 11_000), m("Lenovo USB-C Dock Gen 2", "Lenovo", 10_000)],
    "Type C Hub": [m("Ugreen 7-in-1 USB-C Hub", "Ugreen", 2_000)],
  } },
  Furniture: { cls: "PURCHASING", count: 70, prefix: { "*": "FN" }, warrantyMonths: 12, types: {
    Desk: [m("L-shaped workstation desk", "Quezon Furniture Works", 12_000), m("Office desk 120 cm", "Quezon Furniture Works", 8_000)],
    Chair: [m("Ergonomic mesh chair", "Quezon Furniture Works", 6_500), m("Executive chair", "Quezon Furniture Works", 12_000)],
  } },
  "Pantry Equipment": { cls: "PURCHASING", count: 12, prefix: { "*": "PE" }, warrantyMonths: 12, types: {
    Microwave: [m("Sharp microwave R-20", "Sharp", 6_000)],
    "Air purifier": [m("Xiaomi Air Purifier 4", "Xiaomi", 10_000)],
  } },
  Vehicle: { cls: "PURCHASING", count: 8, prefix: { "*": "VH" }, warrantyMonths: 36, types: {
    Sedan: [m("Toyota Vios 1.3 XLE", "Toyota", 900_000)],
    Van: [m("Toyota HiAce Commuter", "Toyota", 1_900_000)],
  } },
  Building: { cls: "PURCHASING", count: 3, prefix: { "*": "BL" }, warrantyMonths: null, types: {
    Floor: [m("Ortigas office, 21F", "—", 30_000_000), m("Cebu IT Park office, 8F", "—", 22_000_000)],
    Warehouse: [m("Taguig storage warehouse", "—", 25_000_000)],
  } },
};

export const DEFECT_NOTES = [
  "No power after a brownout", "Battery swelling", "Hinge cracked", "Screen flicker", "Keyboard keys unresponsive",
  "Fan noise, overheating", "No display output", "Mic not picking up", "Intermittent USB-C charging", "Dead pixels",
] as const;

export const ASSET_NOTES = [
  "Asset sticker replaced", "Charger swapped for a 65 W unit", "Reimaged with the standard build", "Moved to the 21F floor",
  "BIOS password set", "Docking cable included", "Warranty extended with the vendor", "Cleaned and inspected",
  "Spare battery in the IT cage", "Labelled for the client floor", "Firmware updated", "Box kept in storage",
] as const;

export const EMPLOYEE_NOTES = [
  "Prefers a wireless headset — on the waitlist.", "Working from home on Fridays; VPN required.",
  "Asked for a second monitor; check the policy.", "Laptop runs slow; scheduled for a reimage.",
  "Signed the accountability form.", "Transferred desks to the 21F floor.", "Needs a webcam for client calls.",
  "Reported a missing mouse.", "Account locked twice this week; reset done.", "Joining the night shift next month.",
  "Promoted to team lead, review the kit.", "On leave for two weeks.", "Asked about the laptop buyout.",
  "Headset ear cushion replaced.", "Docking station returned to IT.",
] as const;

export const WARRANTY_CONTACTS = [
  "TechServe PH service desk", "Dell ProSupport hotline", "Lenovo Premier Support", "HP Care Pack desk",
  "Logitech RMA portal", "Octagon Repairs",
] as const;

export const CANCEL_REASONS = [
  "Duplicate request", "Budget moved to next quarter", "Client cancelled the expansion", "Bought from stock instead",
] as const;
