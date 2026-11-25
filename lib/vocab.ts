/**
 * Words a UK T&O surgeon dictates that general speech models get wrong. Used to steer the
 * transcription and to correct it afterwards. Add your own in Settings → Dictation words.
 */
export const ORTHO_TERMS = [
  // Sutures and closure
  "Vicryl", "Vicryl Rapide", "Monocryl", "Ethibond", "PDS", "Prolene", "Nylon", "Ethilon", "Stratafix", "FiberWire", "TigerWire",
  "Orthocord", "Ticron", "Mersilene", "Dermabond", "Steri-Strips", "Opsite", "Mepore", "Aquacel", "Tegaderm", "Ioban", "Kendall",
  "subcuticular", "interrupted", "mattress", "figure-of-eight", "clips",
  // Drugs and theatre
  "TXA", "tranexamic acid", "cefuroxime", "teicoplanin", "gentamicin", "co-amoxiclav", "Chirocaine", "levobupivacaine", "bupivacaine",
  "Marcaine", "ropivacaine", "lidocaine", "adrenaline", "LIA", "chlorhexidine", "Betadine", "iodine", "II", "image intensifier",
  "C-arm", "WHO checklist", "huddle", "tourniquet", "Esmarch", "Rhys-Davies exsanguinator", "Bair Hugger", "TEDs", "Flowtrons",
  // Instruments
  "Bristow", "Hohmann", "Langenbeck", "Czerny", "Morris", "Deaver", "Norfolk and Norwich", "Travers", "Gelpi", "West", "Weitlaner",
  "Kocher", "Lane's", "Gillies", "Adson", "McIndoe", "Mayo", "Metzenbaum", "Cobb", "Howarth", "Watson Cheyne", "Volkmann",
  "Freer", "periosteal elevator", "osteotome", "Capener gouge", "rongeur", "nibbler", "Liston", "curette", "bone hook", "Verbrugge",
  "Weber clamp", "pointed reduction clamp", "Hey Groves", "candlestick", "laminar spreader", "diathermy", "bipolar", "Mayo scissors",
  "K-wire", "Kirschner wire", "guidewire", "drill sleeve", "depth gauge", "countersink", "tap", "Steinmann pin", "Schanz pin",
  // Implants and systems
  "DHS", "dynamic hip screw", "TSP", "trochanteric stabilising plate", "PFNA", "Gamma nail", "TFNA", "InterTAN", "cephalomedullary",
  "Exeter", "CPT", "C-Stem", "Corail", "Pinnacle", "Trident", "Accolade", "Trilogy", "Taperloc", "Furlong", "Thompson's", "Austin Moore",
  "Unitrax", "CPCS", "X-acta", "Mpact", "Mako", "ROSA", "Attune", "PFC Sigma", "Triathlon", "Persona", "NexGen", "Genesis",
  "GMK Sphere", "Medacta", "Journey", "Oxford", "Microplasty", "Zimmer Biomet", "Stryker", "DePuy Synthes", "Smith & Nephew",
  "LCP", "LC-DCP", "DCP", "one-third tubular", "reconstruction plate", "volar locking plate", "Acu-Loc", "VA-LCP", "Synthes",
  "cannulated screw", "Herbert screw", "Acutrak", "headless compression screw", "cortical screw", "cancellous screw", "locking screw",
  "lag screw", "tension band wiring", "cerclage", "Dall-Miles", "Ilizarov", "Taylor Spatial Frame", "Hoffmann", "external fixator",
  "intramedullary nail", "reamer", "suprapatellar", "infrapatellar", "poller screw", "blocking screw", "Philos", "Expert nail",
  "suture anchor", "Corkscrew", "JuggerKnot", "Endobutton", "interference screw", "Arthrex", "spigot", "poly", "polyethylene",
  // Anatomy and approaches
  "Hardinge", "Kocher-Langenbeck", "Smith-Petersen", "Watson-Jones", "Henry", "Thompson", "Kaplan", "Boyd", "deltopectoral",
  "medial parapatellar", "subvastus", "midvastus", "Gibson", "Moore", "posterior approach", "direct anterior approach",
  "TFL", "tensor fascia lata", "gluteus medius", "gluteus minimus", "piriformis", "short external rotators", "quadratus femoris",
  "vastus lateralis", "vastus medialis", "rectus femoris", "sartorius", "iliopsoas", "LFCA", "lateral femoral circumflex",
  "MFCA", "sciatic", "femoral nerve", "LCFN", "lateral cutaneous nerve of the thigh", "PIN", "posterior interosseous nerve",
  "superficial radial nerve", "median nerve", "ulnar nerve", "axillary nerve", "cephalic vein", "pronator quadratus", "FCR",
  "FPL", "brachioradialis", "ECRB", "ECRL", "EPL", "APL", "EDC", "ECU", "FCU", "anconeus", "triceps", "biceps", "LHB",
  "supraspinatus", "infraspinatus", "subscapularis", "teres minor", "coracoid", "acromion", "glenoid", "greater tuberosity",
  "lesser tuberosity", "olecranon", "coronoid", "capitellum", "trochlea", "radial head", "Lister's tubercle", "scaphoid", "lunate",
  "TFCC", "DRUJ", "PRUJ", "syndesmosis", "deltoid ligament", "ATFL", "CFL", "AITFL", "PITFL", "talus", "calcaneus", "navicular",
  "Lisfranc", "Chopart", "Achilles", "tibialis posterior", "peroneal", "peroneus brevis", "medial malleolus", "lateral malleolus",
  "posterior malleolus", "Volkmann fragment", "Chaput", "Wagstaffe", "Maisonneuve", "Weber B", "Weber C", "Schatzker", "Garden",
  "Pauwels", "Vancouver", "Gustilo", "Tscherne", "AO", "OTA", "Neer", "Mason", "Frykman", "Colles", "Smith's", "Barton's",
  "ACL", "PCL", "MCL", "LCL", "PLC", "popliteus", "meniscus", "menisci", "patella", "patellar tendon", "quadriceps tendon", "tibial tuberosity",
  "TT", "Gerdy's tubercle", "intercondylar notch", "trochlear groove", "femoral condyle", "tibial plateau", "PFJ", "Whiteside's line",
  "transepicondylar axis", "posterior condylar axis", "Q angle", "varus", "valgus", "FFD", "fixed flexion deformity", "recurvatum",
  "acetabulum", "transverse acetabular ligament", "TAL", "labrum", "pulvinar", "teardrop", "calcar", "lesser trochanter",
  "greater trochanter", "GT", "LT", "neck–shaft angle", "anteversion", "inclination", "offset", "leg length", "shuck test",
  "tip–apex distance", "TAD", "Baumgaertner", "Parker", "Singh index", "Dorr",
  // Common abbreviations
  "ORIF", "MUA", "K-wires", "THR", "THA", "TKR", "TKA", "UKR", "UKA", "TSR", "rTSR", "ASD", "SAD", "ACJ", "SCJ", "ROM",
  "NWB", "PWB", "FWB", "WBAT", "VTE", "LMWH", "DVT", "PE", "NOF", "#NOF", "AP", "lateral", "Judet", "Lauenstein", "frog leg",
  "CT", "MRI", "abx", "post-op", "pre-op", "FRCS", "SpR", "registrar", "consultant", "scrub nurse", "ODP",
];

/** A short prompt in the style of the transcript: speech models follow example text better than lists. */
export function transcriptionPrompt(extra: string[]): string {
  const words = [...new Set([...extra, ...ORTHO_TERMS])].filter(Boolean);
  const lead =
    "Debrief after a trauma and orthopaedic operation. Closed the fascia with 1 Vicryl, subcut 2-0 Vicryl, skin 3-0 Monocryl, capsule with Ethibond, TXA at induction, check on II. ";
  let out = lead;
  for (const w of words) {
    if ((out + w).length > 1800) break;
    out += `${w}, `;
  }
  return out.replace(/, $/, ".");
}
