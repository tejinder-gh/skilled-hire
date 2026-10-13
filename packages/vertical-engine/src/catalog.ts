import type {
  CatalogSearchResult,
  PricingType,
  RiskTier,
  ServiceCatalogCategory,
  ServiceCatalogVertical,
  ServiceFamily,
  ServiceVariant,
} from "@marketplace/contracts";

export interface CanonicalServiceVariantDefinition {
  slug: string;
  name: string;
  description: string;
  scopeSummary: string;
  riskTier: RiskTier;
  pricingType: PricingType;
  basePriceCents: number;
  defaultDurationMinutes: number;
  requiresPermit: boolean;
  permitType?: string;
  requiredEvidence: string[];
  defaultWarrantyMonths: number;
  geographicRestrictions: string[];
  tags: string[];
  launchReady: boolean;
  displayOrder: number;
}

export interface CanonicalCategoryDefinition {
  slug: string;
  name: string;
  description: string;
  riskTier: RiskTier;
  launchReady: boolean;
  displayOrder: number;
  variants: CanonicalServiceVariantDefinition[];
}

export interface CanonicalVerticalDefinition {
  slug: string;
  name: string;
  family: ServiceFamily;
  description: string;
  icon: string;
  riskTier: RiskTier;
  permitAuthority?: string;
  launchReady: boolean;
  displayOrder: number;
  categories: CanonicalCategoryDefinition[];
}

export const CANONICAL_TRADE_CATALOG: readonly CanonicalVerticalDefinition[] = [
  // 1. HVAC
  {
    slug: "hvac",
    name: "Heating, Ventilation & Air Conditioning",
    family: "MECHANICAL",
    description:
      "Residential and light commercial heating, air conditioning, heat pumps, boilers, and ventilation systems.",
    icon: "thermometer-snowflake",
    riskTier: "HIGH",
    permitAuthority: "TSSA",
    launchReady: true,
    displayOrder: 1,
    categories: [
      {
        slug: "cooling",
        name: "Cooling & Air Conditioning",
        description:
          "Central air conditioners, ductless mini-splits, and heat pumps.",
        riskTier: "HIGH",
        launchReady: true,
        displayOrder: 1,
        variants: [
          {
            slug: "ac-not-cooling",
            name: "AC Diagnostic & Repair",
            description:
              "Diagnostic troubleshooting for central AC systems failing to cool or cycle properly.",
            scopeSummary:
              "Refrigerant pressure check, capacitor test, contactor inspection, coil cleaning.",
            riskTier: "HIGH",
            pricingType: "HOURLY",
            basePriceCents: 14900,
            defaultDurationMinutes: 120,
            requiresPermit: false,
            requiredEvidence: [
              "before_photo",
              "electrical_reading",
              "pressure_gauge_photo",
              "after_photo",
            ],
            defaultWarrantyMonths: 12,
            geographicRestrictions: ["ON", "BC", "CA", "TX"],
            tags: [
              "air conditioner",
              "ac",
              "freon",
              "compressor",
              "cooling",
              "heat pump",
            ],
            launchReady: true,
            displayOrder: 1,
          },
          {
            slug: "heat-pump-installation",
            name: "Heat Pump System Replacement",
            description:
              "High-efficiency cold-climate heat pump installation and commissioning.",
            scopeSummary:
              "Old unit removal, line set flush, electrical hookup, vacuum decay test, commissioning report.",
            riskTier: "CRITICAL",
            pricingType: "FIXED",
            basePriceCents: 750000,
            defaultDurationMinutes: 480,
            requiresPermit: true,
            permitType: "ESA_ELECTRICAL_NOTIFICATION",
            requiredEvidence: [
              "commissioning_sheet",
              "pressure_test_report",
              "permit_inspection_signoff",
              "serial_numbers",
            ],
            defaultWarrantyMonths: 36,
            geographicRestrictions: ["ON", "BC"],
            tags: ["heat pump", "cold climate", "greener homes", "inverter"],
            launchReady: true,
            displayOrder: 2,
          },
        ],
      },
      {
        slug: "heating",
        name: "Heating & Gas Appliances",
        description:
          "Natural gas furnaces, hydronic boilers, and radiant heating.",
        riskTier: "CRITICAL",
        launchReady: true,
        displayOrder: 2,
        variants: [
          {
            slug: "furnace-no-heat",
            name: "Furnace No Heat Diagnostic",
            description:
              "Emergency and standard diagnostic for gas furnaces with ignition or airflow failure.",
            scopeSummary:
              "Ignitor check, flame sensor test, heat exchanger inspection, carbon monoxide safety check.",
            riskTier: "CRITICAL",
            pricingType: "HOURLY",
            basePriceCents: 14900,
            defaultDurationMinutes: 90,
            requiresPermit: false,
            requiredEvidence: [
              "co_sensor_reading",
              "flame_sensor_photo",
              "error_code_log",
            ],
            defaultWarrantyMonths: 12,
            geographicRestrictions: ["ON", "BC", "CA", "TX"],
            tags: [
              "furnace",
              "gas",
              "no heat",
              "ignitor",
              "tssa",
              "heat exchanger",
            ],
            launchReady: true,
            displayOrder: 1,
          },
        ],
      },
      {
        slug: "air-quality",
        name: "Indoor Air Quality & Ventilation",
        description:
          "HRV/ERV systems, whole-home humidifiers, HEPA filtration, and duct sanitation.",
        riskTier: "LOW",
        launchReady: true,
        displayOrder: 3,
        variants: [
          {
            slug: "hrv-erv-service",
            name: "HRV/ERV Maintenance & Balancing",
            description:
              "Seasonal servicing of heat/energy recovery ventilator cores and balanced airflow dampers.",
            scopeSummary:
              "Core wash, pre-filter replacement, exterior hood screen clear, damper check.",
            riskTier: "LOW",
            pricingType: "FIXED",
            basePriceCents: 18900,
            defaultDurationMinutes: 75,
            requiresPermit: false,
            requiredEvidence: ["filter_photo", "core_cleaned_photo"],
            defaultWarrantyMonths: 6,
            geographicRestrictions: ["ON", "BC"],
            tags: ["hrv", "erv", "ventilation", "fresh air", "air quality"],
            launchReady: true,
            displayOrder: 1,
          },
        ],
      },
    ],
  },

  // 2. PLUMBING
  {
    slug: "plumbing",
    name: "Plumbing Systems",
    family: "MECHANICAL",
    description:
      "Potable water supply, drain-waste-vent piping, fixture installation, backflow prevention, and water heaters.",
    icon: "wrench",
    riskTier: "HIGH",
    permitAuthority: "MUNICIPAL",
    launchReady: true,
    displayOrder: 2,
    categories: [
      {
        slug: "drain-sewer",
        name: "Drain & Sewer Services",
        description:
          "Main drain clearing, camera inspection, tree root remediation, and backwater valve maintenance.",
        riskTier: "HIGH",
        launchReady: true,
        displayOrder: 1,
        variants: [
          {
            slug: "main-drain-clog",
            name: "Main Sewer Line Snaking & Camera Scope",
            description:
              "High-torque motorized auger clearing and CCTV camera inspection of blocked main lateral.",
            scopeSummary:
              "Cleanout access, obstruction clearing, camera footage recording to property passport.",
            riskTier: "HIGH",
            pricingType: "FIXED",
            basePriceCents: 32000,
            defaultDurationMinutes: 120,
            requiresPermit: false,
            requiredEvidence: [
              "camera_inspection_video",
              "cleanout_after_photo",
              "flow_test_verified",
            ],
            defaultWarrantyMonths: 6,
            geographicRestrictions: ["ON", "BC", "CA", "TX"],
            tags: [
              "drain",
              "sewer",
              "backup",
              "camera scope",
              "snaking",
              "roots",
            ],
            launchReady: true,
            displayOrder: 1,
          },
        ],
      },
      {
        slug: "water-heaters",
        name: "Water Heaters & Boilers",
        description:
          "Tankless and atmospheric hot water tanks, mixing valves, and expansion vessels.",
        riskTier: "CRITICAL",
        launchReady: true,
        displayOrder: 2,
        variants: [
          {
            slug: "tankless-water-heater-install",
            name: "Tankless Water Heater Installation",
            description:
              "High-efficiency tankless on-demand hot water system replacement and gas venting.",
            scopeSummary:
              "Old tank removal, gas line sizing check, PVC venting, electrical connection, pressure relief discharge.",
            riskTier: "CRITICAL",
            pricingType: "FIXED",
            basePriceCents: 380000,
            defaultDurationMinutes: 360,
            requiresPermit: true,
            permitType: "TSSA_AND_PLUMBING_PERMIT",
            requiredEvidence: [
              "gas_pressure_test",
              "tpr_valve_photo",
              "permit_affidavit",
              "before_after_photos",
            ],
            defaultWarrantyMonths: 24,
            geographicRestrictions: ["ON", "BC"],
            tags: [
              "water heater",
              "tankless",
              "hot water",
              "tssa",
              "gas line",
              "rinnai",
              "navien",
            ],
            launchReady: true,
            displayOrder: 1,
          },
        ],
      },
    ],
  },

  // 3. ELECTRICAL
  {
    slug: "electrical",
    name: "Electrical Contracting",
    family: "MECHANICAL",
    description:
      "Residential electrical distribution, service panel upgrades, EV chargers, wiring rewrites, and safety inspections.",
    icon: "zap",
    riskTier: "CRITICAL",
    permitAuthority: "ESA",
    launchReady: true,
    displayOrder: 3,
    categories: [
      {
        slug: "panel-service",
        name: "Service Panels & Heavy Power",
        description:
          "100A to 200A service upgrades, subpanel additions, and whole-home surge suppression.",
        riskTier: "CRITICAL",
        launchReady: true,
        displayOrder: 1,
        variants: [
          {
            slug: "panel-upgrade-200a",
            name: "200 Amp Service Panel Upgrade",
            description:
              "Full service entrance upgrade including meter base, panel replacement, breaker balance, and ESA inspection.",
            scopeSummary:
              "Utility disconnect/reconnect coordination, new 200A breaker enclosure, grounding rod/plate verification, ESA filing.",
            riskTier: "CRITICAL",
            pricingType: "FIXED",
            basePriceCents: 420000,
            defaultDurationMinutes: 480,
            requiresPermit: true,
            permitType: "ESA_LEC_PERMIT",
            requiredEvidence: [
              "esa_certificate_of_acceptance",
              "panel_schedule_photo",
              "ground_resistance_reading",
              "before_after_photos",
            ],
            defaultWarrantyMonths: 36,
            geographicRestrictions: ["ON"],
            tags: [
              "electrical",
              "200a",
              "panel upgrade",
              "esa",
              "ecra",
              "breaker",
              "hydro",
            ],
            launchReady: true,
            displayOrder: 1,
          },
        ],
      },
      {
        slug: "ev-charging",
        name: "Electric Vehicle (EV) Charging",
        description:
          "Level 2 dedicated branch circuit installation, smart chargers, and load management.",
        riskTier: "HIGH",
        launchReady: true,
        displayOrder: 2,
        variants: [
          {
            slug: "ev-charger-level2",
            name: "Level 2 EV Charger Dedicated 240V Circuit",
            description:
              "NEMA 14-50 receptacle or direct hardwire EVSE installation with dedicated double-pole breaker.",
            scopeSummary:
              "Load calculation check, conduit/Romex run to garage/exterior, ESA notification filing, breaker install.",
            riskTier: "HIGH",
            pricingType: "FIXED",
            basePriceCents: 115000,
            defaultDurationMinutes: 240,
            requiresPermit: true,
            permitType: "ESA_LEC_PERMIT",
            requiredEvidence: [
              "esa_notification_number",
              "charger_active_photo",
              "breaker_rating_photo",
            ],
            defaultWarrantyMonths: 24,
            geographicRestrictions: ["ON"],
            tags: [
              "ev charger",
              "tesla",
              "240v",
              "level 2",
              "esa",
              "garage electrical",
            ],
            launchReady: true,
            displayOrder: 1,
          },
        ],
      },
    ],
  },

  // 4. ROOFING
  {
    slug: "roofing",
    name: "Roofing & Exteriors",
    family: "BUILDING_ENVELOPE",
    description:
      "Architectural shingles, flat roof membranes, flashing, valley repair, and preventative roof leak restoration.",
    icon: "home",
    riskTier: "HIGH",
    permitAuthority: "MUNICIPAL",
    launchReady: true,
    displayOrder: 4,
    categories: [
      {
        slug: "shingle-repair",
        name: "Shingle Repair & Leak Remediation",
        description:
          "Wind damage shingle replacement, leak diagnosis, flashing reseal, and pipe boot replacement.",
        riskTier: "HIGH",
        launchReady: true,
        displayOrder: 1,
        variants: [
          {
            slug: "roof-leak-diagnostic",
            name: "Roof Leak Diagnostic & Emergency Patch",
            description:
              "Attic leak source location, localized membrane patching, replacement of missing architectural shingles.",
            scopeSummary:
              "High-pitch safety harness setup, damaged shingle extraction, underlayment seal, step flashing re-nailing.",
            riskTier: "HIGH",
            pricingType: "HOURLY",
            basePriceCents: 35000,
            defaultDurationMinutes: 180,
            requiresPermit: false,
            requiredEvidence: [
              "fall_protection_log",
              "attic_moisture_photo",
              "repaired_shingles_photo",
            ],
            defaultWarrantyMonths: 12,
            geographicRestrictions: ["ON", "BC", "CA"],
            tags: [
              "roof",
              "leak",
              "shingles",
              "wind damage",
              "flashing",
              "pipe boot",
            ],
            launchReady: true,
            displayOrder: 1,
          },
        ],
      },
    ],
  },

  // 5. WINDOWS & DOORS
  {
    slug: "windows-doors",
    name: "Windows & Doors",
    family: "BUILDING_ENVELOPE",
    description:
      "Energy Star multi-pane window replacement, entry doors, sliding patio doors, framing, and weather sealing.",
    icon: "square",
    riskTier: "MODERATE",
    permitAuthority: "MUNICIPAL",
    launchReady: true,
    displayOrder: 5,
    categories: [
      {
        slug: "entry-doors",
        name: "Entry Doors & Patio Systems",
        description:
          "Steel and fiberglass entry doors, security locksets, and multi-point sliding patio systems.",
        riskTier: "MODERATE",
        launchReady: true,
        displayOrder: 1,
        variants: [
          {
            slug: "entry-door-installation",
            name: "Pre-Hung Exterior Door Installation",
            description:
              "Complete removal and installation of insulated pre-hung exterior door with capping and weatherstripping.",
            scopeSummary:
              "Old frame removal, sill pan flashing, plumb/level shim, low-expansion foam insulation, exterior aluminum capping.",
            riskTier: "MODERATE",
            pricingType: "FIXED",
            basePriceCents: 85000,
            defaultDurationMinutes: 300,
            requiresPermit: false,
            requiredEvidence: [
              "sill_flashing_photo",
              "level_plumb_photo",
              "completed_door_photo",
            ],
            defaultWarrantyMonths: 24,
            geographicRestrictions: ["ON", "BC"],
            tags: [
              "door",
              "exterior door",
              "weatherstripping",
              "framing",
              "capping",
            ],
            launchReady: true,
            displayOrder: 1,
          },
        ],
      },
    ],
  },

  // 6. CARPENTRY
  {
    slug: "carpentry",
    name: "Carpentry & Architectural Millwork",
    family: "STRUCTURAL",
    description:
      "Structural framing, rough carpentry, custom cabinetry, crown moulding, baseboards, and exterior deck builds.",
    icon: "hammer",
    riskTier: "MODERATE",
    permitAuthority: "MUNICIPAL",
    launchReady: true,
    displayOrder: 6,
    categories: [
      {
        slug: "finish-carpentry",
        name: "Finish Carpentry & Trim",
        description:
          "Interior door installation, trim packages, wainscoting, and architectural wall paneling.",
        riskTier: "LOW",
        launchReady: true,
        displayOrder: 1,
        variants: [
          {
            slug: "interior-trim-package",
            name: "Custom Baseboard & Casing Installation",
            description:
              "Precision mitered baseboard, window casing, and door trim installation.",
            scopeSummary:
              "Wall scribe, coped joints, pneumatic fastening, fill, and caulk prep.",
            riskTier: "LOW",
            pricingType: "HOURLY",
            basePriceCents: 8500,
            defaultDurationMinutes: 240,
            requiresPermit: false,
            requiredEvidence: ["miter_joints_photo", "completed_room_photo"],
            defaultWarrantyMonths: 12,
            geographicRestrictions: ["ON", "BC"],
            tags: ["trim", "baseboard", "casing", "carpentry", "moulding"],
            launchReady: true,
            displayOrder: 1,
          },
        ],
      },
    ],
  },

  // 7. KITCHEN & BATHROOM RENOVATIONS
  {
    slug: "kitchen-bath",
    name: "Kitchen & Bathroom Renovations",
    family: "RENOVATION",
    description:
      "Complete turnkey remodels, custom vanities, waterproof shower assemblies, tiling, and luxury plumbing fixtures.",
    icon: "bath",
    riskTier: "HIGH",
    permitAuthority: "MUNICIPAL",
    launchReady: true,
    displayOrder: 7,
    categories: [
      {
        slug: "bathroom-remodel",
        name: "Bathroom Remodeling",
        description:
          "Full gut remodel, curbless showers, Kerdi waterproofing, radiant tile floors, and plumbing reconfiguration.",
        riskTier: "HIGH",
        launchReady: true,
        displayOrder: 1,
        variants: [
          {
            slug: "custom-shower-waterproofing",
            name: "Tile Shower Waterproofing & Pan Install",
            description:
              "Bonded waterproof membrane (Schluter Kerdi/GoBoard) and flood test before tile setting.",
            scopeSummary:
              "Pre-slope verification, membrane banding, drain collar seal, 24-hour standing water flood test signoff.",
            riskTier: "HIGH",
            pricingType: "FIXED",
            basePriceCents: 240000,
            defaultDurationMinutes: 480,
            requiresPermit: false,
            requiredEvidence: [
              "flood_test_photo",
              "membrane_seams_photo",
              "drain_flange_photo",
            ],
            defaultWarrantyMonths: 36,
            geographicRestrictions: ["ON", "BC"],
            tags: ["shower", "kerdi", "waterproofing", "bathroom", "tile pan"],
            launchReady: true,
            displayOrder: 1,
          },
        ],
      },
    ],
  },

  // 8. BASEMENT FINISHING
  {
    slug: "basement-finishing",
    name: "Basement Finishing & Secondary Suites",
    family: "RENOVATION",
    description:
      "Legal secondary dwelling units, egress windows, subfloor insulation, drywalling, and soundproofing.",
    icon: "layers",
    riskTier: "HIGH",
    permitAuthority: "MUNICIPAL",
    launchReady: true,
    displayOrder: 8,
    categories: [
      {
        slug: "egress-windows",
        name: "Egress Windows & Well Systems",
        description:
          "Concrete foundation cut, galvanized egress window well, weeping tile drainage tie-in, and code-compliant window.",
        riskTier: "HIGH",
        launchReady: true,
        displayOrder: 1,
        variants: [
          {
            slug: "egress-window-cut",
            name: "Foundation Concrete Cut & Egress Window Install",
            description:
              "Diamond saw cut through poured concrete foundation with lintel header and escape well.",
            scopeSummary:
              "Exterior excavation, concrete cutting, steel lintel installation, window install, drain gravel bed.",
            riskTier: "HIGH",
            pricingType: "FIXED",
            basePriceCents: 450000,
            defaultDurationMinutes: 600,
            requiresPermit: true,
            permitType: "MUNICIPAL_BUILDING_PERMIT",
            requiredEvidence: [
              "lintel_bearing_photo",
              "window_well_drainage_photo",
              "building_inspection_pass",
            ],
            defaultWarrantyMonths: 60,
            geographicRestrictions: ["ON"],
            tags: [
              "egress",
              "basement",
              "concrete cut",
              "secondary suite",
              "legal basement",
            ],
            launchReady: true,
            displayOrder: 1,
          },
        ],
      },
    ],
  },

  // 9. STRUCTURAL RENOVATIONS
  {
    slug: "structural-renovations",
    name: "Structural Renovations & Load-Bearing Modifications",
    family: "STRUCTURAL",
    description:
      "Load-bearing wall removal, flush-mount steel beam (LVL/W-beam) installations, temporary shoring, and P.Eng stamps.",
    icon: "columns",
    riskTier: "CRITICAL",
    permitAuthority: "MUNICIPAL",
    launchReady: true,
    displayOrder: 9,
    categories: [
      {
        slug: "beam-installation",
        name: "Load-Bearing Wall Removal & Beams",
        description:
          "Engineered beam installations supporting second stories or roof trusses with temporary shoring walls.",
        riskTier: "CRITICAL",
        launchReady: true,
        displayOrder: 1,
        variants: [
          {
            slug: "load-bearing-beam-install",
            name: "Steel / LVL Beam & Post Installation",
            description:
              "Temporary screw-jack shoring, demolition of bearing wall, placement of engineered beam on teleposts/footings.",
            scopeSummary:
              "P.Eng engineering review, shoring erection, beam hoist, post saddle connections, municipal framing inspection.",
            riskTier: "CRITICAL",
            pricingType: "ESTIMATE_REQUIRED",
            basePriceCents: 650000,
            defaultDurationMinutes: 720,
            requiresPermit: true,
            permitType: "MUNICIPAL_BUILDING_PERMIT",
            requiredEvidence: [
              "structural_engineer_stamped_drawing",
              "bearing_post_footing_photo",
              "building_inspector_signoff",
            ],
            defaultWarrantyMonths: 120,
            geographicRestrictions: ["ON"],
            tags: [
              "structural",
              "load bearing",
              "beam",
              "open concept",
              "steel beam",
              "lvl",
              "shoring",
            ],
            launchReady: true,
            displayOrder: 1,
          },
        ],
      },
    ],
  },

  // 10. SIDE ENTRANCES & WALKOUTS
  {
    slug: "side-entrances-walkouts",
    name: "Side Entrances & Basement Walkouts",
    family: "STRUCTURAL",
    description:
      "Exterior concrete stairwells, below-grade walkout doors, drain sumps, retaining walls, and legal entry doors.",
    icon: "door-open",
    riskTier: "CRITICAL",
    permitAuthority: "MUNICIPAL",
    launchReady: true,
    displayOrder: 10,
    categories: [
      {
        slug: "walkout-excavation",
        name: "Below-Grade Walkout & Concrete Cutting",
        description:
          "Full excavation to basement slab, reinforced concrete walls and stairs, drain well connection.",
        riskTier: "CRITICAL",
        launchReady: true,
        displayOrder: 1,
        variants: [
          {
            slug: "separate-side-entrance",
            name: "Below-Grade Concrete Side Entrance",
            description:
              "Excavation, concrete stairwell pour or pre-cast stairs, foundation doorway cut, door install, and drain tie-in.",
            scopeSummary:
              "Locate utilities, excavate, cut foundation, pour retaining curb, install weeping tile drain, install exterior insulated door.",
            riskTier: "CRITICAL",
            pricingType: "ESTIMATE_REQUIRED",
            basePriceCents: 1200000,
            defaultDurationMinutes: 1440,
            requiresPermit: true,
            permitType: "MUNICIPAL_BUILDING_PERMIT",
            requiredEvidence: [
              "utility_locates",
              "drain_tie_in_photo",
              "rebar_reinforcement_photo",
              "municipal_inspection_pass",
            ],
            defaultWarrantyMonths: 60,
            geographicRestrictions: ["ON"],
            tags: [
              "side entrance",
              "walkout",
              "separate entrance",
              "basement door",
              "concrete cut",
            ],
            launchReady: true,
            displayOrder: 1,
          },
        ],
      },
    ],
  },

  // 11. DRIVEWAYS & PAVING
  {
    slug: "driveways-paving",
    name: "Driveways & Asphalt Paving",
    family: "SITEWORK",
    description:
      "Hot-mix asphalt paving, concrete driveways, gravel sub-base compaction, and commercial grade sealcoating.",
    icon: "truck",
    riskTier: "MODERATE",
    permitAuthority: "MUNICIPAL",
    launchReady: true,
    displayOrder: 11,
    categories: [
      {
        slug: "asphalt-paving",
        name: "Asphalt Paving & Grading",
        description:
          "Driveway tear-out, heavy crushed stone limestone compaction, hot-mix HL3 asphalt rolling.",
        riskTier: "MODERATE",
        launchReady: true,
        displayOrder: 1,
        variants: [
          {
            slug: "driveway-asphalt-repave",
            name: "Residential Driveway Asphalt Paving",
            description:
              "Excavation, 6-inch Granular 'A' stone base, vibratory roller compaction, 2.5-inch compacted hot-mix asphalt.",
            scopeSummary:
              "Old asphalt disposal, grade check for drainage away from foundation, base compaction, hot-mix laydown.",
            riskTier: "MODERATE",
            pricingType: "FIXED",
            basePriceCents: 380000,
            defaultDurationMinutes: 480,
            requiresPermit: false,
            requiredEvidence: [
              "compaction_depth_measurement",
              "grade_slope_verification",
              "finished_driveway_photo",
            ],
            defaultWarrantyMonths: 24,
            geographicRestrictions: ["ON"],
            tags: [
              "driveway",
              "paving",
              "asphalt",
              "hl3",
              "grading",
              "roadwork",
            ],
            launchReady: true,
            displayOrder: 1,
          },
        ],
      },
    ],
  },

  // 12. INTERLOCKING & MASONRY
  {
    slug: "interlocking-masonry",
    name: "Interlocking & Masonry",
    family: "SITEWORK",
    description:
      "Stone pavers, retaining walls, flagstone steps, brick chimney repair, tuckpointing, and outdoor living patios.",
    icon: "grid",
    riskTier: "MODERATE",
    permitAuthority: "NONE",
    launchReady: true,
    displayOrder: 12,
    categories: [
      {
        slug: "paver-patio",
        name: "Interlocking Pavers & Walkways",
        description:
          "Polymeric sand pavers, retaining wall blocks, step coping, and geotextile sub-base preparation.",
        riskTier: "MODERATE",
        launchReady: true,
        displayOrder: 1,
        variants: [
          {
            slug: "interlock-paver-patio",
            name: "Interlock Stone Patio Installation",
            description:
              "Excavation, geotextile fabric, HPB or aggregate base, paver laydown, edge restraint, and polymeric sand vibratory plate compaction.",
            scopeSummary:
              "Grade check, base lay, paver cutting, edge spikes, sweep sand, activate with mist.",
            riskTier: "MODERATE",
            pricingType: "FIXED",
            basePriceCents: 450000,
            defaultDurationMinutes: 600,
            requiresPermit: false,
            requiredEvidence: [
              "excavation_depth_photo",
              "edge_restraint_photo",
              "polymeric_sand_photo",
            ],
            defaultWarrantyMonths: 36,
            geographicRestrictions: ["ON", "BC"],
            tags: [
              "interlock",
              "pavers",
              "patio",
              "walkway",
              "polymeric sand",
              "retaining wall",
            ],
            launchReady: true,
            displayOrder: 1,
          },
        ],
      },
    ],
  },

  // 13. LANDSCAPING
  {
    slug: "landscaping",
    name: "Landscaping & Property Grounds",
    family: "PROPERTY_MAINTENANCE",
    description:
      "Lot grading, sodding, French drains, tree planting, automated irrigation systems, and seasonal lawn restoration.",
    icon: "flower",
    riskTier: "LOW",
    permitAuthority: "NONE",
    launchReady: true,
    displayOrder: 13,
    categories: [
      {
        slug: "grading-sod",
        name: "Grading & Sod Installation",
        description:
          "Laser grading for foundation water diversion, screened topsoil spread, and fresh Kentucky bluegrass sod installation.",
        riskTier: "LOW",
        launchReady: true,
        displayOrder: 1,
        variants: [
          {
            slug: "lawn-sod-replacement",
            name: "Old Lawn Stripping & New Sodding",
            description:
              "Rototill/strip weed cover, grade slope 2% away from house, topsoil enriching, fresh sod rolling.",
            scopeSummary:
              "Strip old lawn, add 2 inches triple-mix, laser level, roll sod tightly, roller compact, initial soak.",
            riskTier: "LOW",
            pricingType: "FIXED",
            basePriceCents: 180000,
            defaultDurationMinutes: 360,
            requiresPermit: false,
            requiredEvidence: ["grading_slope_photo", "finished_sod_photo"],
            defaultWarrantyMonths: 3,
            geographicRestrictions: ["ON", "BC"],
            tags: ["sod", "grass", "lawn", "grading", "topsoil", "landscaping"],
            launchReady: true,
            displayOrder: 1,
          },
        ],
      },
    ],
  },

  // 14. CLEANING
  {
    slug: "cleaning",
    name: "Specialized Deep Cleaning & Sanitation",
    family: "PROPERTY_MAINTENANCE",
    description:
      "Post-construction dust remediation, HVAC air duct vacuuming, pressure washing, and move-out turnover sanitation.",
    icon: "sparkles",
    riskTier: "LOW",
    permitAuthority: "NONE",
    launchReady: true,
    displayOrder: 14,
    categories: [
      {
        slug: "air-duct-cleaning",
        name: "HVAC Air Duct Sanitization",
        description:
          "Truck-mounted negative air vacuum, rotary brush agitation, and EPA-approved botanical antimicrobial fogging.",
        riskTier: "LOW",
        launchReady: true,
        displayOrder: 1,
        variants: [
          {
            slug: "whole-home-duct-clean",
            name: "Whole-Home High-Power Duct Cleaning",
            description:
              "High-CFM negative air hookup to main plenum, whip air tools through all supply/return registers.",
            scopeSummary:
              "Seal registers, hook up trunk lines, clean J-channel, wipe blower wheel, fog sanitizing solution.",
            riskTier: "LOW",
            pricingType: "FIXED",
            basePriceCents: 29900,
            defaultDurationMinutes: 150,
            requiresPermit: false,
            requiredEvidence: [
              "plenum_access_sealed_photo",
              "before_after_duct_photo",
            ],
            defaultWarrantyMonths: 1,
            geographicRestrictions: ["ON", "BC"],
            tags: [
              "duct cleaning",
              "air ducts",
              "furnace cleaning",
              "allergens",
              "vacuum",
            ],
            launchReady: true,
            displayOrder: 1,
          },
        ],
      },
    ],
  },

  // 15. PAINTING
  {
    slug: "painting",
    name: "Interior & Exterior Painting",
    family: "RENOVATION",
    description:
      "Premium interior wall and trim painting, drywall skim coating, airless exterior spray, and wood staining.",
    icon: "palette",
    riskTier: "LOW",
    permitAuthority: "NONE",
    launchReady: true,
    displayOrder: 15,
    categories: [
      {
        slug: "interior-painting",
        name: "Interior Residential Painting",
        description:
          "Masking, surface preparation, primer sealer, and two coats of low-VOC architectural latex enamel.",
        riskTier: "LOW",
        launchReady: true,
        displayOrder: 1,
        variants: [
          {
            slug: "room-repaint-standard",
            name: "Standard Room Wall & Ceiling Repaint",
            description:
              "Comprehensive masking, drywall patch sanding, edge cut-in, and two coats of washable paint.",
            scopeSummary:
              "Furniture cover, floor paper masking, spackle nail holes, sand, cut and roll walls.",
            riskTier: "LOW",
            pricingType: "HOURLY",
            basePriceCents: 6500,
            defaultDurationMinutes: 240,
            requiresPermit: false,
            requiredEvidence: [
              "masking_prep_photo",
              "drywall_patch_photo",
              "finished_room_photo",
            ],
            defaultWarrantyMonths: 24,
            geographicRestrictions: ["ON", "BC"],
            tags: [
              "painting",
              "interior painting",
              "benjamin moore",
              "drywall repair",
              "roller",
            ],
            launchReady: true,
            displayOrder: 1,
          },
        ],
      },
    ],
  },

  // 16. PEST & WILDLIFE CONTROL
  {
    slug: "pest-wildlife",
    name: "Pest & Humane Wildlife Control",
    family: "SPECIALTY",
    description:
      "Humane wildlife exclusion (raccoons, squirrels, bats), rodent eradication, wasp elimination, and entry-point mesh sealing.",
    icon: "shield",
    riskTier: "MODERATE",
    permitAuthority: "NONE",
    launchReady: true,
    displayOrder: 16,
    categories: [
      {
        slug: "wildlife-exclusion",
        name: "Humane Attic Wildlife Exclusion",
        description:
          "One-way exit door installation, roof vent wire mesh animal-proofing, and cleanout sanitation.",
        riskTier: "MODERATE",
        launchReady: true,
        displayOrder: 1,
        variants: [
          {
            slug: "raccoons-attic-exclusion",
            name: "Raccoon / Squirrel Attic Exclusion & Screening",
            description:
              "Identification of roof roof-line entry holes, heavy gauge galvanized steel mesh install, and one-way door.",
            scopeSummary:
              "Rooftop harness access, install one-way spring exit gate, secure perimeter vents with stainless steel screws.",
            riskTier: "MODERATE",
            pricingType: "FIXED",
            basePriceCents: 45000,
            defaultDurationMinutes: 180,
            requiresPermit: false,
            requiredEvidence: [
              "entry_point_mesh_photo",
              "one_way_door_photo",
              "attic_inspection_photo",
            ],
            defaultWarrantyMonths: 12,
            geographicRestrictions: ["ON", "BC"],
            tags: [
              "wildlife",
              "raccoons",
              "squirrels",
              "attic",
              "humane pest control",
              "exclusion",
            ],
            launchReady: true,
            displayOrder: 1,
          },
        ],
      },
    ],
  },

  // 17. APPLIANCE REPAIR
  {
    slug: "appliance-repair",
    name: "Appliance Repair & Installation",
    family: "MECHANICAL",
    description:
      "Major residential appliance repair: refrigerators, dishwashers, washing machines, gas ranges, and dryers.",
    icon: "tool",
    riskTier: "MODERATE",
    permitAuthority: "TSSA",
    launchReady: true,
    displayOrder: 17,
    categories: [
      {
        slug: "laundry-kitchen",
        name: "Kitchen & Laundry Appliance Repair",
        description:
          "Electronic control board diagnostics, drain pumps, heating elements, water valves, and motors.",
        riskTier: "MODERATE",
        launchReady: true,
        displayOrder: 1,
        variants: [
          {
            slug: "appliance-diagnostic-repair",
            name: "Appliance Diagnostic & Component Replacement",
            description:
              "System error code read, multimeter component check, and OEM replacement part installation.",
            scopeSummary:
              "Fault code extraction, electrical continuity test, part swap, leak and run cycle verification.",
            riskTier: "MODERATE",
            pricingType: "HOURLY",
            basePriceCents: 11900,
            defaultDurationMinutes: 90,
            requiresPermit: false,
            requiredEvidence: [
              "multimeter_reading_photo",
              "oem_part_packaging_photo",
              "completed_test_cycle_photo",
            ],
            defaultWarrantyMonths: 6,
            geographicRestrictions: ["ON", "BC"],
            tags: [
              "appliance",
              "dishwasher",
              "washer",
              "dryer",
              "fridge",
              "samsung",
              "whirlpool",
            ],
            launchReady: true,
            displayOrder: 1,
          },
        ],
      },
    ],
  },

  // 18. SECURITY & SMART HOME
  {
    slug: "security-smart-home",
    name: "Security & Smart Home Automation",
    family: "SPECIALTY",
    description:
      "Low-voltage network cabling, PoE camera systems, video doorbells, smart deadbolts, and smart thermostats.",
    icon: "camera",
    riskTier: "LOW",
    permitAuthority: "NONE",
    launchReady: true,
    displayOrder: 18,
    categories: [
      {
        slug: "cameras-access",
        name: "Video Surveillance & Smart Access",
        description:
          "Hardwired PoE IP security cameras, NVR configuration, smart biometric deadbolts, and chime relays.",
        riskTier: "LOW",
        launchReady: true,
        displayOrder: 1,
        variants: [
          {
            slug: "poe-camera-system-install",
            name: "4-Channel PoE Camera & NVR Setup",
            description:
              "Cat6 Ethernet cable fishing through attic/exterior soffit, camera mounting, and mobile app provisioning.",
            scopeSummary:
              "Exterior soffit drill, cable fish, weatherproof RJ45 termination, camera focus, local NVR hard drive configuration.",
            riskTier: "LOW",
            pricingType: "FIXED",
            basePriceCents: 75000,
            defaultDurationMinutes: 300,
            requiresPermit: false,
            requiredEvidence: [
              "camera_live_feed_screenshot",
              "soffit_cable_seal_photo",
              "nvr_cabinet_photo",
            ],
            defaultWarrantyMonths: 12,
            geographicRestrictions: ["ON", "BC"],
            tags: [
              "security camera",
              "poe",
              "smart home",
              "doorbell",
              "nvr",
              "cat6",
            ],
            launchReady: true,
            displayOrder: 1,
          },
        ],
      },
    ],
  },

  // 19. WATERPROOFING
  {
    slug: "waterproofing",
    name: "Foundation Waterproofing & Sump Pumps",
    family: "BUILDING_ENVELOPE",
    description:
      "Exterior excavation to footing, elastomeric membrane, dimple sheet, weeping tile replacement, and battery backup sump pumps.",
    icon: "shield-alert",
    riskTier: "CRITICAL",
    permitAuthority: "MUNICIPAL",
    launchReady: true,
    displayOrder: 19,
    categories: [
      {
        slug: "exterior-waterproofing",
        name: "Exterior Foundation Excavation & Membrane",
        description:
          "Excavate to foundation footing, hydraulic cement crack injection, rubberized membrane, and Delta-MS drainage board.",
        riskTier: "CRITICAL",
        launchReady: true,
        displayOrder: 1,
        variants: [
          {
            slug: "exterior-waterproofing-footing",
            name: "Exterior Weeping Tile & Membrane System",
            description:
              'Excavation down to footings, foundation parging, rubberized membrane, drainage board, perforated 4" weeping tile.',
            scopeSummary:
              "Locate utilities, excavate trench, clean concrete, hydraulic cement seal, primer and elastomeric spray, dimple board, clear stone gravel bed.",
            riskTier: "CRITICAL",
            pricingType: "ESTIMATE_REQUIRED",
            basePriceCents: 950000,
            defaultDurationMinutes: 960,
            requiresPermit: false,
            requiredEvidence: [
              "utility_locates",
              "footing_exposed_photo",
              "membrane_delta_board_photo",
              "weeping_tile_gravel_bed_photo",
            ],
            defaultWarrantyMonths: 300, // 25 years
            geographicRestrictions: ["ON"],
            tags: [
              "waterproofing",
              "wet basement",
              "weeping tile",
              "foundation leak",
              "delta ms",
              "sump pump",
            ],
            launchReady: true,
            displayOrder: 1,
          },
        ],
      },
      {
        slug: "sump-pumps",
        name: "Sump Systems & Backflow Prevention",
        description:
          "Submersible sump pump basins, check valves, dedicated 12V AGM battery backup pumps, and municipal backwater valves.",
        riskTier: "HIGH",
        launchReady: true,
        displayOrder: 2,
        variants: [
          {
            slug: "battery-backup-sump-pump",
            name: "Dual Sump Pump & Battery Backup System",
            description:
              "Primary 1/2 HP pump paired with secondary DC emergency pump, inverter charging station, and high water alarm.",
            scopeSummary:
              "Basin cleanout, install primary and backup pump assemblies with separate check valves, wire battery float switch, simulate power outage test.",
            riskTier: "HIGH",
            pricingType: "FIXED",
            basePriceCents: 145000,
            defaultDurationMinutes: 240,
            requiresPermit: false,
            requiredEvidence: [
              "basin_clean_photo",
              "dual_discharge_pipe_photo",
              "battery_load_test_verified",
            ],
            defaultWarrantyMonths: 36,
            geographicRestrictions: ["ON", "BC"],
            tags: [
              "sump pump",
              "battery backup",
              "flooding",
              "basement flood",
              "check valve",
            ],
            launchReady: true,
            displayOrder: 1,
          },
        ],
      },
    ],
  },

  // 20. MOVING & JUNK REMOVAL
  {
    slug: "moving-junk-removal",
    name: "Moving & Trade Waste Junk Removal",
    family: "SPECIALTY",
    description:
      "Post-renovation construction debris hauling, drywall and scrap tile disposal, transfer station compliance, and heavy lifting.",
    icon: "truck",
    riskTier: "LOW",
    permitAuthority: "NONE",
    launchReady: true,
    displayOrder: 20,
    categories: [
      {
        slug: "construction-debris",
        name: "Renovation Waste & Heavy Debris Removal",
        description:
          "Haul-away of drywall, tiles, lumber, cabinetry, and old appliances with licensed municipal disposal tipping receipts.",
        riskTier: "LOW",
        launchReady: true,
        displayOrder: 1,
        variants: [
          {
            slug: "truck-load-renovation-waste",
            name: "Full Dump-Trailer Renovation Debris Haul",
            description:
              "Up to 14-yard dump trailer load of mixed non-hazardous renovation debris swept broom-clean.",
            scopeSummary:
              "Site load, heavy material loading, tarp and secure load, broom sweep of driveway/site, transfer station manifest.",
            riskTier: "LOW",
            pricingType: "FIXED",
            basePriceCents: 59500,
            defaultDurationMinutes: 180,
            requiresPermit: false,
            requiredEvidence: [
              "before_debris_photo",
              "site_swept_photo",
              "transfer_station_scale_ticket",
            ],
            defaultWarrantyMonths: 0,
            geographicRestrictions: ["ON", "BC"],
            tags: [
              "junk removal",
              "debris",
              "demolition haul",
              "drywall disposal",
              "cleanout",
            ],
            launchReady: true,
            displayOrder: 1,
          },
        ],
      },
    ],
  },

  // 21. SEASONAL SERVICES
  {
    slug: "seasonal-services",
    name: "Seasonal Maintenance & Winterization",
    family: "PROPERTY_MAINTENANCE",
    description:
      "Fall gutter cleanout, sprinkler blowouts, exterior spigot winterization, snow plowing, and spring de-winterization checks.",
    icon: "calendar",
    riskTier: "LOW",
    permitAuthority: "NONE",
    launchReady: true,
    displayOrder: 21,
    categories: [
      {
        slug: "fall-winterization",
        name: "Fall Home Winterization & Gutter Flush",
        description:
          "Roof eaves trough and downspout debris flushing, sprinkler air compressor blow out, and hose bib shutoffs.",
        riskTier: "LOW",
        launchReady: true,
        displayOrder: 1,
        variants: [
          {
            slug: "gutter-clean-irrigation-blowout",
            name: "Complete Fall Gutter Clean & Sprinkler Blowout",
            description:
              "Ladder safety gutter vacuum/hand clean, high-pressure downspout flow test, 80 CFM compressor irrigation purge.",
            scopeSummary:
              "Clear all gutters and bagging of organic debris, test downspout drainage, hook compressor to sprinkler manifold and cycle each zone.",
            riskTier: "LOW",
            pricingType: "FIXED",
            basePriceCents: 22000,
            defaultDurationMinutes: 120,
            requiresPermit: false,
            requiredEvidence: [
              "ladder_safety_photo",
              "clean_gutters_photo",
              "sprinkler_zone_purge_video",
            ],
            defaultWarrantyMonths: 1,
            geographicRestrictions: ["ON", "BC"],
            tags: [
              "gutters",
              "eaves trough",
              "sprinkler blowout",
              "winterization",
              "fall maintenance",
            ],
            launchReady: true,
            displayOrder: 1,
          },
        ],
      },
    ],
  },
] as const;

/**
 * Perform tokenized and relevance-weighted search across the catalog.
 */
export function searchCatalog(
  catalog: readonly CanonicalVerticalDefinition[],
  query: string,
  options?: {
    geography?: string;
    family?: ServiceFamily;
    launchReadyOnly?: boolean;
    maxRiskTier?: RiskTier;
  },
): CatalogSearchResult[] {
  const q = query.trim().toLowerCase();
  const tokens = q.split(/\s+/).filter(Boolean);
  const geo = (options?.geography ?? "*").toUpperCase();
  const results: CatalogSearchResult[] = [];

  const riskTierRank: Record<RiskTier, number> = {
    LOW: 1,
    MODERATE: 2,
    HIGH: 3,
    CRITICAL: 4,
  };
  const maxTierRank = options?.maxRiskTier
    ? riskTierRank[options.maxRiskTier]
    : 4;

  for (const vertical of catalog) {
    if (options?.family && vertical.family !== options.family) continue;
    if (options?.launchReadyOnly && !vertical.launchReady) continue;

    for (const category of vertical.categories) {
      if (options?.launchReadyOnly && !category.launchReady) continue;

      for (const variant of category.variants) {
        if (options?.launchReadyOnly && !variant.launchReady) continue;
        if (riskTierRank[variant.riskTier] > maxTierRank) continue;

        // Check geographic restrictions
        if (geo !== "*" && variant.geographicRestrictions.length > 0) {
          const matchedGeo = variant.geographicRestrictions.some(
            (g) => g === "*" || g.toUpperCase() === geo,
          );
          if (!matchedGeo) continue;
        }

        // Calculate relevance match score
        let score = 0;
        const searchableText =
          `${vertical.name} ${category.name} ${variant.name} ${variant.description} ${variant.scopeSummary} ${variant.tags.join(" ")}`.toLowerCase();

        if (tokens.length === 0) {
          // If no query, return all matching filters with base score
          score = 100 - variant.displayOrder;
        } else {
          for (const token of tokens) {
            if (variant.name.toLowerCase().includes(token)) score += 50;
            else if (category.name.toLowerCase().includes(token)) score += 30;
            else if (vertical.name.toLowerCase().includes(token)) score += 20;
            else if (variant.tags.some((t) => t.toLowerCase().includes(token)))
              score += 40;
            else if (searchableText.includes(token)) score += 10;
          }
        }

        if (score > 0) {
          results.push({
            verticalId: "",
            verticalSlug: vertical.slug,
            verticalName: vertical.name,
            verticalFamily: vertical.family,
            categoryId: "",
            categorySlug: category.slug,
            categoryName: category.name,
            variantId: "",
            variantSlug: variant.slug,
            variantName: variant.name,
            description: variant.description,
            riskTier: variant.riskTier,
            pricingType: variant.pricingType,
            basePriceCents: variant.basePriceCents,
            requiresPermit: variant.requiresPermit,
            permitType: variant.permitType ?? null,
            launchReady: variant.launchReady,
            matchScore: score,
          });
        }
      }
    }
  }

  return results.sort((a, b) => b.matchScore - a.matchScore);
}
