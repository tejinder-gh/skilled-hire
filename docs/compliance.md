# Regulatory Compliance & Standards Registry

This system governs statutory government regulations, trade certifications, environmental mandates, insurance requirements, and background checks for service providers across trade domains (verticals) and geographic locations (jurisdictions).

## 1. The 6 Statutory Regulatory Groups

All provider compliance requirements are grouped into six canonical regulatory pillars:

| Group Code | Pillar Name | Description | Required Entity Scope |
|---|---|---|---|
| `TRADE_LICENSING` | **Trade & Professional Licensing** | Occupational certificates of qualification, journeyperson cards, master licenses, and state/provincial contractor board authorizations. | Contractor & Technician |
| `ENVIRONMENTAL_HAZARDOUS` | **Environmental & Hazardous Materials** | Clean Air Act (EPA Section 608), Ozone Depleting Substances (ODS/Halocarbons), EPA Lead-Safe Renovation (RRP), and asbestos regulations. | Contractor & Technician |
| `INSURANCE_FINANCIAL` | **Insurance, Bonding & Financial Security** | Commercial general liability ($2M+ min), statutory workers' compensation clearance (WSIB / State Fund), commercial fleet auto, and surety bonds. | Contractor Entity |
| `HEALTH_SAFETY` | **Occupational Health & Site Safety** | Mandatory fall protection/working at heights (CPO/OSHA approved), OSHA 10/30 construction safety, and First Aid/CPR. | Technician |
| `STATUTORY_REGISTRATION` | **Statutory Business & Municipal Registration** | Corporate registration in good standing, technical safety authority registration (e.g. TSSA Heating Fuels), and municipal trades licensing. | Contractor Entity |
| `TRUST_IDENTITY` | **Trust, Safety & Identity Verification** | Government-issued photo identification, annual criminal background screening with vulnerable sector verification, and clean driving abstracts. | Technician & Owner |

---

## 2. Multi-Jurisdiction & Multi-Domain Standards Matrix

Standards are evaluated per `(vertical_slug, geography, entity_level)` with fallbacks to `*` for universal requirements:

| Domain | Geography / Jurisdiction | Standard Code | Regulatory Body | Legal Reference | Verification Method |
|---|---|---|---|---|---|
| **HVAC** | `ON` (Ontario, Canada) | `ON_TSSA_GAS_G2` | Technical Standards & Safety Authority (TSSA) | Technical Standards & Safety Act, O.Reg 215/01 | API Registry |
| **HVAC** | `ON` (Ontario, Canada) | `ON_SKILLED_TRADES_313A` | Skilled Trades Ontario | BOSTA Act, 313A Refrigeration Mechanic | API Registry |
| **HVAC** | `ON` (Ontario, Canada) | `CA_ODS_REFRIGERANT` | HRAI / Environment Canada / MOECC | Ontario Reg 463/10 (Halocarbons) | Document Upload |
| **HVAC** | `ON` (Ontario, Canada) | `ON_TSSA_CONTRACTOR_REG` | TSSA Heating Fuels Division | TSSA Act Fuel Safety Division | Document Upload |
| **HVAC** | `ON` (Ontario, Canada) | `ON_WSIB_CLEARANCE` | Workplace Safety & Insurance Board (WSIB) | WSIA Section 141 Clearance | API Registry |
| **HVAC** | `ON` (Ontario, Canada) | `ON_MOL_HEIGHTS` | Ontario Ministry of Labour (CPO) | Occupational Health & Safety Act O.Reg 297/13 | Document Upload |
| **HVAC** | `CA` (California, USA) | `CA_CSLB_C20` | Contractors State License Board (CSLB) | California B&P Code § 7058 Class C-20 | API Registry |
| **HVAC** | `CA` (California, USA) | `US_EPA_608_UNIVERSAL` | US Environmental Protection Agency (EPA) | Clean Air Act Section 608 (40 CFR Part 82) | Document Upload |
| **HVAC** | `CA` (California, USA) | `CA_CSLB_SURETY_BOND` | California Licensed Surety Underwriter | California B&P Code § 7071.6 ($25,000 Bond) | Document Upload |
| **HVAC** | `CA` (California, USA) | `CA_WORKERS_COMP` | California Department of Industrial Relations (DIR) | California Labor Code § 3700 | Document Upload |
| **HVAC** | `TX` (Texas, USA) | `TX_TDLR_ACR_CLASS_A` | Texas Dept. of Licensing & Regulation (TDLR) | Texas Occupations Code Chapter 1302 | API Registry |
| **HVAC** | `TX` (Texas, USA) | `US_EPA_608_UNIVERSAL` | US Environmental Protection Agency (EPA) | Clean Air Act Section 608 | Document Upload |
| **HVAC** | `TX` (Texas, USA) | `TX_TDLR_INSURANCE` | Texas Department of Insurance / TDLR | 16 TAC § 75.40 Insurance Requirements | Document Upload |
| **HVAC** | `BC` (British Columbia) | `BC_TECH_SAFETY_GAS_A_B`| Technical Safety BC | Safety Standards Act & Gas Safety Reg | API Registry |
| **HVAC** | `BC` (British Columbia) | `BC_WORKSAFE_CLEARANCE` | WorkSafeBC | Workers Compensation Act Part 5 | API Registry |
| **Plumbing**| `ON` (Ontario, Canada) | `ON_SKILLED_TRADES_306A` | Skilled Trades Ontario | Building Opportunities in the Skilled Trades Act | API Registry |
| **Plumbing**| `CA` (California, USA) | `CA_CSLB_C36` | California CSLB | California B&P Code § 7058 Class C-36 | API Registry |
| **Electrical**| `ON` (Ontario, Canada) | `ON_ESA_LEC_CONTRACTOR` | Electrical Safety Authority (ESA / ECRA) | Electricity Act, 1998, O.Reg 570/05 | API Registry |
| **Electrical**| `CA` (California, USA) | `CA_CSLB_C10` | California CSLB | California B&P Code § 7058 Class C-10 | API Registry |
| **Roofing**| `*` (Universal) | `ROOFING_FALL_PROTECTION` | Accredited Safety Training Institute | OSHA 1926 Subpart M / Provincial Fall Protection | Document Upload |
| **All** | `*` (Universal) | `CGL_INSURANCE_2M` | Commercial Insurance Underwriter | Standard Marketplace $2M Commercial Liability | Document Upload |
| **All** | `*` (Universal) | `COMMERCIAL_AUTO_1M` | Commercial Fleet Auto Carrier | Commercial Auto Coverage ($1M) | Document Upload |
| **All** | `*` (Universal) | `GOVT_PHOTO_ID` | State / Provincial Licensing Authority | Marketplace Identity Verification Policy | Document Upload |
| **All** | `*` (Universal) | `BACKGROUND_CHECK_ANNUAL`| Accredited Background Screening / Police | Residential Trust & Safety Standard (Annual) | Document Upload |

---

## 3. Verification Scorecard Engine

The rule engine evaluates provider credentials against the applicable standards matrix:
- **`overallStatus`**:
  - `VERIFIED`: All mandatory statutory standards are held, verified, and not expired.
  - `DEFICIENT`: One or more mandatory standards are missing or rejected.
  - `EXPIRED`: One or more mandatory standards have passed their expiration date.
  - `PENDING_REVIEW`: Documents submitted, awaiting administrative review.
- **`scoreBps`**: Calculated weighted score (0–10,000 basis points) where mandatory standards contribute 80% and recommended badges contribute 20%.
- **Dispatch Gate**: Dispatch operations and algorithm matching strictly deny any candidate whose overall status is not `VERIFIED` in the request's specific jurisdiction and vertical.

---

## 4. API Endpoints

- `GET /v1/compliance/groups`: List canonical regulatory groups with metadata and ordering.
- `GET /v1/compliance/standards?vertical=:v&geography=:geo&entityLevel=:e`: Filter standards by vertical, jurisdiction, and entity scope.
- `POST /v1/compliance/evaluate`: Evaluate any candidate's credential list against target vertical + geography, returning an itemized scorecard and actionable gap list.
- `GET /v1/contractors/:id/compliance`: Retrieve compliance scorecard for an existing contractor across their service areas.
- `POST /v1/credentials/submit`: Submit a credential document for audit.
