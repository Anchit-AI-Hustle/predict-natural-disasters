'use strict';
/**
 * Verified humanitarian support directory.
 *
 * Rules applied to every record in this file:
 *  - Emergency numbers are national numbers that are publicly published by the
 *    relevant government/public-safety authority. Where no number could be
 *    verified, the country entry carries authorities only and the UI states
 *    that no verified number is stored instead of guessing one.
 *  - Every organisation URL points at the organisation's own domain.
 *  - Email addresses are only included where the organisation publishes them
 *    on its own contact page. Otherwise `contactUrl` is used.
 *  - A link that answered 404 Not Found to a browser is replaced by the same
 *    organisation's page that answered instead, or dropped where none did
 *    (checked 29 September 2026). A 403 or a timeout is not treated as dead:
 *    many of these sites refuse any automated visitor.
 *
 * CommonJS on purpose: Vercel's Node runtime treats `api/*.js` as CommonJS
 * unless the project declares ESM, so `import`/`export` here would make the
 * function fail to boot.
 */

const GLOBAL_RELIEF = [
  {
    name: 'IFRC / Red Cross Red Crescent',
    kind: 'Emergency relief network - 191 national societies',
    url: 'https://www.ifrc.org/emergencies/all',
    donate: 'https://www.ifrc.org/donate',
    contactUrl: 'https://www.ifrc.org/contact',
    email: 'secretariat@ifrc.org',
    phone: '+41 22 730 4222'
  },
  {
    name: 'UNICEF',
    kind: 'Children, family, water and sanitation emergency support',
    url: 'https://www.unicef.org/emergencies',
    donate: 'https://help.unicef.org/en/give-now',
    contactUrl: 'https://www.unicef.org/contact-us'
  },
  {
    name: 'UN World Food Programme',
    kind: 'Emergency food assistance and humanitarian logistics',
    url: 'https://www.wfp.org/emergencies',
    donate: 'https://www.wfp.org/support-us',
    contactUrl: 'https://www.wfp.org/contact'
  },
  {
    name: 'UNHCR',
    kind: 'Displacement, shelter and protection support',
    url: 'https://www.unhcr.org/emergencies',
    donate: 'https://donate.unhcr.org/',
    contactUrl: 'https://www.unhcr.org/contact-us'
  },
  {
    name: 'UN Crisis Relief / CERF',
    kind: 'UN pooled humanitarian crisis funding',
    url: 'https://crisisrelief.un.org/',
    donate: 'https://crisisrelief.un.org/',
    contactUrl: 'https://www.unocha.org/contact-us'
  },
  {
    name: 'Médecins Sans Frontières (Doctors Without Borders)',
    kind: 'Emergency medical response',
    url: 'https://www.msf.org/',
    donate: 'https://www.msf.org/donate',
    contactUrl: 'https://www.msf.org/contact-us'
  },
  {
    name: 'Direct Relief',
    kind: 'Emergency medical supplies and disaster health logistics',
    url: 'https://www.directrelief.org/emergency/',
    donate: 'https://www.directrelief.org/emergency/',
    contactUrl: 'https://www.directrelief.org/about/contact/'
  },
  {
    name: 'GlobalGiving Disaster Response',
    kind: 'Vetted local-organisation disaster funds',
    url: 'https://www.globalgiving.org/disaster-recovery/',
    donate: 'https://www.globalgiving.org/disaster-recovery/',
    contactUrl: 'https://www.globalgiving.org/aboutus/contact/'
  },
  {
    name: 'Save the Children',
    kind: 'Child-focused emergency response',
    url: 'https://www.savethechildren.net/what-we-do/emergencies',
    donate: 'https://www.savethechildren.net/donate',
    contactUrl: 'https://www.savethechildren.net/contact-us'
  },
  {
    name: 'CARE International',
    kind: 'Emergency relief, food security and women-led response',
    url: 'https://www.care-international.org/',
    donate: 'https://www.care-international.org/donate',
    contactUrl: 'https://www.care-international.org/contact-us'
  }
];

/** Directories that are always valid regardless of which country is affected. */
const GLOBAL_DIRECTORIES = [
  { name: 'ReliefWeb (UN OCHA)', kind: 'Situation reports, maps and humanitarian updates', url: 'https://reliefweb.int/' },
  { name: 'GDACS', kind: 'Global Disaster Alert and Coordination System', url: 'https://www.gdacs.org/' },
  { name: 'IFRC national society directory', kind: 'Find the Red Cross / Red Crescent society for any country', url: 'https://www.ifrc.org/national-societies-directory' },
  { name: 'UN OCHA', kind: 'UN humanitarian coordination', url: 'https://www.unocha.org/' },
  { name: 'WHO Emergencies', kind: 'Health emergency guidance and response', url: 'https://www.who.int/emergencies' }
];

const n = (label, phone, note) => ({ label, phone, note: note || '' });

/**
 * country slug -> support record.
 * emergency: verified national emergency numbers
 * authorities: national disaster-management / meteorological / geological agencies
 * relief: national relief organisations with their own donation pages
 */
const COUNTRY_SUPPORT = {
  india: {
    name: 'India',
    iso2: 'IN',
    emergency: [
      n('All-in-one emergency response (ERSS)', '112', 'Police, fire and ambulance, nationwide'),
      n('Fire and rescue', '101'),
      n('Ambulance / medical emergency', '102'),
      n('Emergency medical services (most states)', '108'),
      n('Disaster management helpline', '1078', 'National Disaster Management control room')
    ],
    authorities: [
      { name: 'National Disaster Management Authority (NDMA)', url: 'https://ndma.gov.in/', contactUrl: 'https://ndma.gov.in/Contact-Us' },
      { name: 'National Disaster Response Force (NDRF)', url: 'https://www.ndrf.gov.in/', contactUrl: 'https://www.ndrf.gov.in/contact-us' },
      { name: 'India Meteorological Department (IMD)', url: 'https://mausam.imd.gov.in/' },
      { name: 'Central Water Commission - flood forecasting', url: 'https://ffs.india-water.gov.in/' }
    ],
    relief: [
      { name: 'Indian Red Cross Society', url: 'https://indianredcross.org/', donate: 'https://indianredcross.org/donate/' },
      { name: 'Goonj', url: 'https://goonj.org/', donate: 'https://goonj.org/donate/' },
      { name: 'SEEDS India', url: 'https://www.seedsindia.org/', donate: 'https://www.seedsindia.org/donate/' }
    ]
  },
  nepal: {
    name: 'Nepal',
    iso2: 'NP',
    emergency: [
      n('Police', '100'),
      n('Fire brigade', '101'),
      n('Ambulance', '102'),
      n('National Emergency Operation Centre (NEOC)', '1149', 'Toll-free disaster hotline')
    ],
    authorities: [
      { name: 'National Disaster Risk Reduction and Management Authority', url: 'https://bipad.gov.np/' },
      { name: 'Department of Hydrology and Meteorology', url: 'https://www.dhm.gov.np/' },
      { name: 'Ministry of Home Affairs - Nepal', url: 'https://www.moha.gov.np/' }
    ],
    relief: [
      { name: 'Nepal Red Cross Society', url: 'https://nrcs.org/' }
    ]
  },
  vietnam: {
    name: 'Viet Nam',
    iso2: 'VN',
    emergency: [
      n('Police', '113'),
      n('Fire and rescue', '114'),
      n('Ambulance / medical emergency', '115')
    ],
    authorities: [
      { name: 'National Center for Hydro-Meteorological Forecasting', url: 'https://nchmf.gov.vn/' },
      { name: 'Viet Nam Disaster and Dyke Management Authority', url: 'https://phongchongthientai.mard.gov.vn/' }
    ],
    relief: [
      { name: 'Viet Nam Red Cross Society', url: 'https://redcross.org.vn/' }
    ]
  },
  indonesia: {
    name: 'Indonesia',
    iso2: 'ID',
    emergency: [
      n('National emergency call centre', '112'),
      n('Police', '110'),
      n('Fire brigade', '113'),
      n('Ambulance / medical emergency', '119')
    ],
    authorities: [
      { name: 'BNPB - National Disaster Management Authority', url: 'https://www.bnpb.go.id/' },
      { name: 'BMKG - Meteorology, Climatology and Geophysics Agency', url: 'https://www.bmkg.go.id/' },
      { name: 'PVMBG - Volcanology and Geological Hazard Mitigation', url: 'https://magma.esdm.go.id/' }
    ],
    relief: [
      { name: 'Palang Merah Indonesia (Indonesian Red Cross)', url: 'https://www.pmi.or.id/' }
    ]
  },
  philippines: {
    name: 'Philippines',
    iso2: 'PH',
    emergency: [
      n('National emergency hotline', '911', 'Police, fire and medical emergencies')
    ],
    authorities: [
      { name: 'NDRRMC - National Disaster Risk Reduction and Management Council', url: 'https://ndrrmc.gov.ph/' },
      { name: 'PAGASA - weather and flood warnings', url: 'https://www.pagasa.dost.gov.ph/' },
      { name: 'PHIVOLCS - volcano and earthquake', url: 'https://www.phivolcs.dost.gov.ph/' }
    ],
    relief: [
      { name: 'Philippine Red Cross', url: 'https://redcross.org.ph/' }
    ]
  },
  bangladesh: {
    name: 'Bangladesh',
    iso2: 'BD',
    emergency: [
      n('National emergency service', '999', 'Police, fire and ambulance'),
      n('Health helpline', '16263')
    ],
    authorities: [
      { name: 'Department of Disaster Management', url: 'https://ddm.gov.bd/' },
      { name: 'Bangladesh Meteorological Department', url: 'https://www.bmd.gov.bd/' },
      { name: 'Flood Forecasting and Warning Centre', url: 'https://www.ffwc.gov.bd/' }
    ],
    relief: [
      { name: 'Bangladesh Red Crescent Society', url: 'https://bdrcs.org/' },
      { name: 'BRAC', url: 'https://www.brac.net/' }
    ]
  },
  pakistan: {
    name: 'Pakistan',
    iso2: 'PK',
    emergency: [
      n('Rescue 1122 emergency service', '1122'),
      n('Police', '15'),
      n('Edhi ambulance', '115')
    ],
    authorities: [
      { name: 'National Disaster Management Authority (NDMA)', url: 'https://www.ndma.gov.pk/' },
      { name: 'Pakistan Meteorological Department', url: 'https://www.pmd.gov.pk/' }
    ],
    relief: [
      { name: 'Pakistan Red Crescent Society', url: 'https://prcs.org.pk/' },
      { name: 'Edhi Foundation', url: 'https://edhi.org/' }
    ]
  },
  sri_lanka: {
    name: 'Sri Lanka',
    iso2: 'LK',
    emergency: [
      n('Disaster Management Centre hotline', '117'),
      n('Police emergency', '119'),
      n('Ambulance / fire', '110')
    ],
    authorities: [
      { name: 'Disaster Management Centre', url: 'https://www.dmc.gov.lk/' },
      { name: 'Department of Meteorology', url: 'https://www.meteo.gov.lk/' }
    ],
    relief: [
      { name: 'Sri Lanka Red Cross Society', url: 'https://www.redcross.lk/' }
    ]
  },
  japan: {
    name: 'Japan',
    iso2: 'JP',
    emergency: [
      n('Police', '110'),
      n('Fire and ambulance', '119')
    ],
    authorities: [
      { name: 'Japan Meteorological Agency', url: 'https://www.jma.go.jp/jma/indexe.html' },
      { name: 'Cabinet Office Disaster Management', url: 'https://www.bousai.go.jp/en/' }
    ],
    relief: [
      { name: 'Japanese Red Cross Society', url: 'https://www.jrc.or.jp/english/' }
    ]
  },
  china: {
    name: 'China',
    iso2: 'CN',
    emergency: [
      n('Police', '110'),
      n('Fire', '119'),
      n('Ambulance', '120')
    ],
    authorities: [
      { name: 'Ministry of Emergency Management', url: 'https://www.mem.gov.cn/' },
      { name: 'China Meteorological Administration', url: 'https://www.cma.gov.cn/en2014/' }
    ],
    relief: [
      { name: 'Red Cross Society of China', url: 'https://www.redcross.org.cn/' }
    ]
  },
  south_korea: {
    name: 'South Korea',
    iso2: 'KR',
    emergency: [
      n('Police', '112'),
      n('Fire, rescue and ambulance', '119')
    ],
    authorities: [
      { name: 'Ministry of the Interior and Safety', url: 'https://www.mois.go.kr/eng/a01/engMain.do' },
      { name: 'Korea Meteorological Administration', url: 'https://www.kma.go.kr/neng/index.do' }
    ],
    relief: [
      { name: 'Korean Red Cross', url: 'https://www.redcross.or.kr/' }
    ]
  },
  taiwan: {
    name: 'Taiwan',
    iso2: 'TW',
    emergency: [n('Police', '110'), n('Fire and ambulance', '119')],
    authorities: [
      { name: 'Central Weather Administration', url: 'https://www.cwa.gov.tw/V8/E/' },
      { name: 'National Fire Agency', url: 'https://www.nfa.gov.tw/eng/' }
    ],
    relief: [{ name: 'Red Cross Society of the Republic of China', url: 'https://www.redcross.org.tw/' }]
  },
  thailand: {
    name: 'Thailand',
    iso2: 'TH',
    emergency: [
      n('Police', '191'),
      n('Fire', '199'),
      n('Emergency medical services', '1669'),
      n('Disaster prevention and mitigation hotline', '1784')
    ],
    authorities: [
      { name: 'Department of Disaster Prevention and Mitigation', url: 'https://www.disaster.go.th/' },
      { name: 'Thai Meteorological Department', url: 'https://www.tmd.go.th/en/' }
    ],
    relief: [{ name: 'Thai Red Cross Society', url: 'https://english.redcross.or.th/' }]
  },
  malaysia: {
    name: 'Malaysia',
    iso2: 'MY',
    emergency: [n('Police and ambulance', '999'), n('Emergency from a mobile phone', '112')],
    authorities: [
      { name: 'NADMA - National Disaster Management Agency', url: 'https://www.nadma.gov.my/' },
      { name: 'Malaysian Meteorological Department', url: 'https://www.met.gov.my/' }
    ],
    relief: [{ name: 'Malaysian Red Crescent Society', url: 'https://www.redcrescent.org.my/' }]
  },
  singapore: {
    name: 'Singapore',
    iso2: 'SG',
    emergency: [n('Police', '999'), n('Fire and ambulance', '995')],
    authorities: [
      { name: 'Singapore Civil Defence Force', url: 'https://www.scdf.gov.sg/' },
      { name: 'Meteorological Service Singapore', url: 'https://www.weather.gov.sg/' }
    ],
    relief: [{ name: 'Singapore Red Cross', url: 'https://www.redcross.sg/', donate: 'https://www.redcross.sg/donate-now/' }]
  },
  cambodia: {
    name: 'Cambodia',
    iso2: 'KH',
    emergency: [n('Police', '117'), n('Fire', '118'), n('Ambulance', '119')],
    authorities: [{ name: 'National Committee for Disaster Management', url: 'https://ncdm.gov.kh/' }],
    relief: [{ name: 'Cambodian Red Cross', url: 'https://www.redcross.org.kh/' }]
  },
  myanmar: {
    name: 'Myanmar',
    iso2: 'MM',
    emergency: [],
    authorities: [{ name: 'Department of Meteorology and Hydrology', url: 'https://www.moezala.gov.mm/' }],
    relief: [{ name: 'Myanmar Red Cross Society', url: 'https://www.myanmarredcrosssociety.org/' }]
  },
  afghanistan: { name: 'Afghanistan', iso2: 'AF', emergency: [], authorities: [], relief: [{ name: 'Afghan Red Crescent Society', url: 'https://arcs.af/' }] },
  united_states: {
    name: 'United States',
    iso2: 'US',
    emergency: [
      n('Emergency services', '911', 'Police, fire and ambulance'),
      n('FEMA helpline', '1-800-621-3362', 'Disaster assistance')
    ],
    authorities: [
      { name: 'FEMA', url: 'https://www.fema.gov/', contactUrl: 'https://www.fema.gov/about/contact' },
      { name: 'National Weather Service', url: 'https://www.weather.gov/' },
      { name: 'USGS Earthquake Hazards Program', url: 'https://earthquake.usgs.gov/' },
      { name: 'National Hurricane Center', url: 'https://www.nhc.noaa.gov/' }
    ],
    relief: [
      { name: 'American Red Cross', url: 'https://www.redcross.org/', donate: 'https://www.redcross.org/donate/donation.html' },
      { name: 'Team Rubicon', url: 'https://teamrubiconusa.org/' },
      { name: 'National VOAD', url: 'https://www.nvoad.org/' }
    ]
  },
  canada: {
    name: 'Canada',
    iso2: 'CA',
    emergency: [n('Emergency services', '911')],
    authorities: [
      { name: 'Public Safety Canada', url: 'https://www.publicsafety.gc.ca/' },
      { name: 'Environment and Climate Change Canada - weather', url: 'https://weather.gc.ca/' }
    ],
    relief: [{ name: 'Canadian Red Cross', url: 'https://www.redcross.ca/', donate: 'https://donate.redcross.ca/' }]
  },
  mexico: {
    name: 'Mexico',
    iso2: 'MX',
    emergency: [n('Emergency services', '911')],
    authorities: [
      { name: 'Coordinación Nacional de Protección Civil', url: 'https://www.gob.mx/segob/acciones-y-programas/proteccion-civil' },
      { name: 'Servicio Meteorológico Nacional', url: 'https://smn.conagua.gob.mx/' },
      { name: 'Servicio Sismológico Nacional', url: 'http://www.ssn.unam.mx/' }
    ],
    relief: [{ name: 'Cruz Roja Mexicana', url: 'https://www.cruzrojamexicana.org.mx/' }]
  },
  brazil: {
    name: 'Brazil',
    iso2: 'BR',
    emergency: [
      n('Police', '190'),
      n('Ambulance (SAMU)', '192'),
      n('Fire brigade', '193'),
      n('Civil Defence', '199')
    ],
    authorities: [
      { name: 'Defesa Civil Nacional', url: 'https://www.gov.br/mdr/pt-br/assuntos/protecao-e-defesa-civil' },
      { name: 'INMET - national meteorology', url: 'https://portal.inmet.gov.br/' },
      { name: 'CEMADEN - natural disaster monitoring', url: 'https://www.gov.br/cemaden/pt-br' }
    ],
    relief: [{ name: 'Cruz Vermelha Brasileira', url: 'https://www.cruzvermelha.org.br/' }]
  },
  argentina: {
    name: 'Argentina',
    iso2: 'AR',
    emergency: [n('Emergency services', '911'), n('Fire brigade', '100'), n('Ambulance', '107')],
    authorities: [
      { name: 'Servicio Meteorológico Nacional', url: 'https://www.smn.gob.ar/' },
      { name: 'Ministerio de Seguridad', url: 'https://www.argentina.gob.ar/seguridad' }
    ],
    relief: [{ name: 'Cruz Roja Argentina', url: 'https://www.cruzroja.org.ar/' }]
  },
  chile: {
    name: 'Chile',
    iso2: 'CL',
    emergency: [n('Police (Carabineros)', '133'), n('Ambulance (SAMU)', '131'), n('Fire brigade', '132')],
    authorities: [
      { name: 'SENAPRED - disaster prevention and response', url: 'https://senapred.cl/' },
      { name: 'Dirección Meteorológica de Chile', url: 'https://www.meteochile.gob.cl/' },
      { name: 'Centro Sismológico Nacional', url: 'https://www.sismologia.cl/' }
    ],
    relief: [{ name: 'Cruz Roja Chilena', url: 'https://www.cruzroja.cl/' }]
  },
  colombia: {
    name: 'Colombia',
    iso2: 'CO',
    emergency: [n('Emergency services', '123')],
    authorities: [
      { name: 'UNGRD - disaster risk management', url: 'https://portal.gestiondelriesgo.gov.co/' },
      { name: 'IDEAM - meteorology and hydrology', url: 'http://www.ideam.gov.co/' }
    ],
    relief: [{ name: 'Cruz Roja Colombiana', url: 'https://www.cruzrojacolombiana.org/' }]
  },
  peru: {
    name: 'Peru',
    iso2: 'PE',
    emergency: [n('Police', '105'), n('Fire brigade', '116'), n('Civil defence (INDECI)', '115')],
    authorities: [
      { name: 'INDECI - National Civil Defence Institute', url: 'https://www.gob.pe/indeci' },
      { name: 'SENAMHI - meteorology and hydrology', url: 'https://www.senamhi.gob.pe/' }
    ],
    relief: [{ name: 'Cruz Roja Peruana', url: 'https://cruzroja.org.pe/' }]
  },
  ecuador: {
    name: 'Ecuador',
    iso2: 'EC',
    emergency: [n('Emergency services', '911')],
    authorities: [
      { name: 'Servicio Nacional de Gestión de Riesgos', url: 'https://www.gestionderiesgos.gob.ec/' },
      { name: 'Instituto Geofísico EPN', url: 'https://www.igepn.edu.ec/' }
    ],
    relief: [{ name: 'Cruz Roja Ecuatoriana', url: 'https://www.cruzroja.org.ec/' }]
  },
  united_kingdom: {
    name: 'United Kingdom',
    iso2: 'GB',
    emergency: [n('Emergency services', '999'), n('Emergency services (EU number)', '112'), n('Non-emergency police', '101')],
    authorities: [
      { name: 'Met Office weather warnings', url: 'https://www.metoffice.gov.uk/weather/warnings-and-advice/uk-warnings' },
      { name: 'Environment Agency flood warnings', url: 'https://check-for-flooding.service.gov.uk/' }
    ],
    relief: [{ name: 'British Red Cross', url: 'https://www.redcross.org.uk/', donate: 'https://donate.redcross.org.uk/' }]
  },
  ireland: {
    name: 'Ireland', iso2: 'IE',
    emergency: [n('Emergency services', '112'), n('Emergency services', '999')],
    authorities: [{ name: 'Met Éireann warnings', url: 'https://www.met.ie/warnings' }],
    relief: [{ name: 'Irish Red Cross', url: 'https://www.redcross.ie/' }]
  },
  france: {
    name: 'France', iso2: 'FR',
    emergency: [n('European emergency number', '112'), n('Medical emergencies (SAMU)', '15'), n('Police', '17'), n('Fire and rescue', '18')],
    authorities: [{ name: 'Météo-France vigilance', url: 'https://vigilance.meteofrance.fr/' }, { name: 'Ministère de l’Intérieur - sécurité civile', url: 'https://www.interieur.gouv.fr/Le-ministere/Securite-civile' }],
    relief: [{ name: 'Croix-Rouge française', url: 'https://www.croix-rouge.fr/' }]
  },
  germany: {
    name: 'Germany', iso2: 'DE',
    emergency: [n('Fire, rescue and ambulance', '112'), n('Police', '110')],
    authorities: [{ name: 'BBK - Federal Office of Civil Protection', url: 'https://www.bbk.bund.de/' }, { name: 'Deutscher Wetterdienst warnings', url: 'https://www.dwd.de/EN/weather/warnings/warnings_node.html' }],
    relief: [{ name: 'Deutsches Rotes Kreuz', url: 'https://www.drk.de/' }]
  },
  italy: {
    name: 'Italy', iso2: 'IT',
    emergency: [n('European emergency number', '112')],
    authorities: [{ name: 'Protezione Civile', url: 'https://www.protezionecivile.gov.it/' }, { name: 'INGV - earthquakes and volcanoes', url: 'https://www.ingv.it/' }],
    relief: [{ name: 'Croce Rossa Italiana', url: 'https://cri.it/' }]
  },
  spain: {
    name: 'Spain', iso2: 'ES',
    emergency: [n('European emergency number', '112')],
    authorities: [{ name: 'Protección Civil y Emergencias', url: 'https://www.proteccioncivil.es/' }, { name: 'AEMET - meteorology', url: 'https://www.aemet.es/' }],
    relief: [{ name: 'Cruz Roja Española', url: 'https://www2.cruzroja.es/' }]
  },
  portugal: {
    name: 'Portugal', iso2: 'PT',
    emergency: [n('European emergency number', '112')],
    authorities: [{ name: 'ANEPC - civil protection', url: 'https://prociv.gov.pt/' }, { name: 'IPMA - meteorology and seismology', url: 'https://www.ipma.pt/' }],
    relief: [{ name: 'Cruz Vermelha Portuguesa', url: 'https://www.cruzvermelha.pt/' }]
  },
  greece: {
    name: 'Greece', iso2: 'GR',
    emergency: [n('European emergency number', '112'), n('Fire brigade', '199'), n('Ambulance (EKAB)', '166')],
    authorities: [{ name: 'General Secretariat for Civil Protection', url: 'https://www.civilprotection.gov.gr/' }, { name: 'National Observatory of Athens - seismology', url: 'https://www.gein.noa.gr/' }],
    relief: [{ name: 'Hellenic Red Cross', url: 'https://www.redcross.gr/' }]
  },
  turkey: {
    name: 'Türkiye', iso2: 'TR',
    emergency: [n('Emergency call centre', '112')],
    authorities: [{ name: 'AFAD - Disaster and Emergency Management', url: 'https://en.afad.gov.tr/' }, { name: 'Turkish State Meteorological Service', url: 'https://www.mgm.gov.tr/eng/forecast-cities.aspx' }],
    relief: [{ name: 'Türk Kızılay (Turkish Red Crescent)', url: 'https://www.kizilay.org.tr/' }]
  },
  netherlands: { name: 'Netherlands', iso2: 'NL', emergency: [n('European emergency number', '112')], authorities: [{ name: 'KNMI weather warnings', url: 'https://www.knmi.nl/nederland-nu/weer/waarschuwingen' }], relief: [{ name: 'Het Nederlandse Rode Kruis', url: 'https://www.rodekruis.nl/' }] },
  belgium: { name: 'Belgium', iso2: 'BE', emergency: [n('European emergency number', '112'), n('Police', '101')], authorities: [{ name: 'National Crisis Centre', url: 'https://crisiscentrum.be/' }, { name: 'RMI weather warnings', url: 'https://www.meteo.be/' }], relief: [{ name: 'Croix-Rouge de Belgique', url: 'https://www.croix-rouge.be/' }] },
  switzerland: { name: 'Switzerland', iso2: 'CH', emergency: [n('European emergency number', '112'), n('Police', '117'), n('Fire', '118'), n('Ambulance', '144')], authorities: [{ name: 'MeteoSwiss warnings', url: 'https://www.meteoswiss.admin.ch/' }, { name: 'Federal Office for Civil Protection', url: 'https://www.babs.admin.ch/' }], relief: [{ name: 'Swiss Red Cross', url: 'https://www.redcross.ch/' }] },
  austria: { name: 'Austria', iso2: 'AT', emergency: [n('European emergency number', '112'), n('Ambulance', '144'), n('Fire', '122')], authorities: [{ name: 'GeoSphere Austria warnings', url: 'https://www.geosphere.at/' }], relief: [{ name: 'Österreichisches Rotes Kreuz', url: 'https://www.roteskreuz.at/' }] },
  poland: { name: 'Poland', iso2: 'PL', emergency: [n('European emergency number', '112')], authorities: [{ name: 'IMGW - meteorology and water management', url: 'https://www.imgw.pl/' }, { name: 'Government Centre for Security', url: 'https://www.gov.pl/web/rcb' }], relief: [{ name: 'Polski Czerwony Krzyż', url: 'https://pck.pl/' }] },
  norway: { name: 'Norway', iso2: 'NO', emergency: [n('Fire', '110'), n('Police', '112'), n('Ambulance', '113')], authorities: [{ name: 'MET Norway warnings', url: 'https://www.yr.no/en' }, { name: 'NVE - flood and landslide warnings', url: 'https://varsom.no/en/' }], relief: [{ name: 'Røde Kors Norge', url: 'https://www.rodekors.no/' }] },
  sweden: { name: 'Sweden', iso2: 'SE', emergency: [n('Emergency services', '112')], authorities: [{ name: 'SMHI warnings', url: 'https://www.smhi.se/' }, { name: 'MSB - civil contingencies', url: 'https://www.msb.se/' }], relief: [{ name: 'Svenska Röda Korset', url: 'https://www.rodakorset.se/' }] },
  finland: { name: 'Finland', iso2: 'FI', emergency: [n('Emergency services', '112')], authorities: [{ name: 'Finnish Meteorological Institute warnings', url: 'https://en.ilmatieteenlaitos.fi/warnings' }], relief: [{ name: 'Suomen Punainen Risti', url: 'https://www.punainenristi.fi/' }] },
  denmark: { name: 'Denmark', iso2: 'DK', emergency: [n('Emergency services', '112')], authorities: [{ name: 'DMI warnings', url: 'https://www.dmi.dk/' }], relief: [{ name: 'Røde Kors Danmark', url: 'https://www.rodekors.dk/' }] },
  iceland: { name: 'Iceland', iso2: 'IS', emergency: [n('Emergency services', '112')], authorities: [{ name: 'Icelandic Met Office - volcano and weather', url: 'https://en.vedur.is/' }, { name: 'Department of Civil Protection', url: 'https://www.almannavarnir.is/' }], relief: [{ name: 'Icelandic Red Cross', url: 'https://www.raudikrossinn.is/' }] },
  ukraine: { name: 'Ukraine', iso2: 'UA', emergency: [n('Emergency services', '112'), n('State Emergency Service', '101')], authorities: [{ name: 'State Emergency Service of Ukraine', url: 'https://dsns.gov.ua/' }], relief: [{ name: 'Ukrainian Red Cross Society', url: 'https://redcross.org.ua/' }] },
  russia: { name: 'Russia', iso2: 'RU', emergency: [n('Emergency services', '112'), n('EMERCOM', '101')], authorities: [{ name: 'EMERCOM of Russia', url: 'https://mchs.gov.ru/' }], relief: [{ name: 'Russian Red Cross', url: 'https://www.redcross.ru/' }] },
  australia: {
    name: 'Australia', iso2: 'AU',
    emergency: [n('Emergency services', '000'), n('Emergency from a mobile phone', '112'), n('State Emergency Service (storm and flood)', '132 500')],
    authorities: [
      { name: 'Bureau of Meteorology warnings', url: 'https://www.bom.gov.au/australia/warnings/' },
      { name: 'Disaster Assist', url: 'https://www.disasterassist.gov.au/' },
      { name: 'National Emergency Management Agency', url: 'https://www.nema.gov.au/' }
    ],
    relief: [{ name: 'Australian Red Cross', url: 'https://www.redcross.org.au/', donate: 'https://www.redcross.org.au/donate/' }]
  },
  new_zealand: {
    name: 'New Zealand', iso2: 'NZ',
    emergency: [n('Emergency services', '111')],
    authorities: [
      { name: 'National Emergency Management Agency', url: 'https://www.civildefence.govt.nz/' },
      { name: 'MetService warnings', url: 'https://www.metservice.com/warnings/home' },
      { name: 'GeoNet - earthquake, volcano, tsunami', url: 'https://www.geonet.org.nz/' }
    ],
    relief: [{ name: 'New Zealand Red Cross', url: 'https://www.redcross.org.nz/' }]
  },
  fiji: { name: 'Fiji', iso2: 'FJ', emergency: [n('Emergency services', '911')], authorities: [{ name: 'Fiji Meteorological Service', url: 'https://www.met.gov.fj/' }, { name: 'National Disaster Management Office', url: 'https://www.ndmo.gov.fj/' }], relief: [{ name: 'Fiji Red Cross Society', url: 'https://www.fijiredcross.org/' }] },
  papua_new_guinea: { name: 'Papua New Guinea', iso2: 'PG', emergency: [], authorities: [{ name: 'PNG National Weather Service', url: 'https://pngmet.gov.pg/' }], relief: [{ name: 'Papua New Guinea Red Cross Society', url: 'https://www.pngredcross.org.pg/' }] },
  south_africa: {
    name: 'South Africa', iso2: 'ZA',
    emergency: [n('Police (SAPS)', '10111'), n('Ambulance and fire', '10177'), n('Emergency from a mobile phone', '112')],
    authorities: [{ name: 'National Disaster Management Centre', url: 'https://www.cogta.gov.za/' }, { name: 'South African Weather Service', url: 'https://www.weathersa.co.za/' }],
    relief: [{ name: 'South African Red Cross Society', url: 'https://www.redcross.org.za/' }, { name: 'Gift of the Givers', url: 'https://giftofthegivers.org/' }]
  },
  kenya: { name: 'Kenya', iso2: 'KE', emergency: [n('Emergency services', '999'), n('Emergency services', '112')], authorities: [{ name: 'Kenya Meteorological Department', url: 'https://meteo.go.ke/' }, { name: 'National Disaster Operations Centre', url: 'https://www.ndoc.go.ke/' }], relief: [{ name: 'Kenya Red Cross Society', url: 'https://www.redcross.or.ke/' }] },
  nigeria: { name: 'Nigeria', iso2: 'NG', emergency: [n('National emergency number', '112', 'Police, fire and medical emergencies')], authorities: [{ name: 'NEMA - National Emergency Management Agency', url: 'https://nema.gov.ng/' }, { name: 'NiMet - Nigerian Meteorological Agency', url: 'https://nimet.gov.ng/' }], relief: [{ name: 'Nigerian Red Cross Society', url: 'https://www.redcrossnigeria.org/' }] },
  ghana: { name: 'Ghana', iso2: 'GH', emergency: [n('National emergency number', '112'), n('Police', '191'), n('Ambulance', '193')], authorities: [{ name: 'NADMO - National Disaster Management Organisation', url: 'https://nadmo.gov.gh/' }, { name: 'Ghana Meteorological Agency', url: 'https://www.meteo.gov.gh/' }], relief: [{ name: 'Ghana Red Cross Society', url: 'https://www.ghanaredcross.org/' }] },
  ethiopia: { name: 'Ethiopia', iso2: 'ET', emergency: [], authorities: [{ name: 'Ethiopian Meteorology Institute', url: 'http://www.ethiomet.gov.et/' }], relief: [{ name: 'Ethiopian Red Cross Society', url: 'https://redcrosseth.org/' }] },
  tanzania: { name: 'Tanzania', iso2: 'TZ', emergency: [n('Emergency services', '112')], authorities: [{ name: 'Tanzania Meteorological Authority', url: 'https://www.meteo.go.tz/' }], relief: [{ name: 'Tanzania Red Cross National Society', url: 'https://trcs.or.tz/' }] },
  uganda: { name: 'Uganda', iso2: 'UG', emergency: [n('Emergency services', '999'), n('Emergency services', '112')], authorities: [{ name: 'Uganda National Meteorological Authority', url: 'https://www.unma.go.ug/' }], relief: [{ name: 'Uganda Red Cross Society', url: 'https://www.redcrossug.org/' }] },
  morocco: { name: 'Morocco', iso2: 'MA', emergency: [n('Police', '19'), n('Ambulance / fire (Protection Civile)', '15'), n('Gendarmerie Royale', '177')], authorities: [{ name: 'Direction Générale de la Météorologie', url: 'https://www.marocmeteo.ma/' }], relief: [{ name: 'Croissant-Rouge Marocain', url: 'https://www.croissant-rouge.ma/' }] },
  egypt: { name: 'Egypt', iso2: 'EG', emergency: [n('Police', '122'), n('Ambulance', '123'), n('Fire', '180')], authorities: [{ name: 'Egyptian Meteorological Authority', url: 'http://ema.gov.eg/' }], relief: [{ name: 'Egyptian Red Crescent Society', url: 'https://egyptianrc.org/' }] },
  tunisia: { name: 'Tunisia', iso2: 'TN', emergency: [n('Police', '197'), n('Ambulance (SAMU)', '190'), n('Civil protection', '198')], authorities: [{ name: 'Institut National de la Météorologie', url: 'http://www.meteo.tn/' }], relief: [{ name: 'Croissant-Rouge Tunisien', url: 'https://www.croissant-rouge.tn/' }] },
  algeria: { name: 'Algeria', iso2: 'DZ', emergency: [n('Police', '17'), n('Gendarmerie', '1055'), n('Civil protection', '14')], authorities: [{ name: 'Office National de la Météorologie', url: 'https://www.meteo.dz/' }], relief: [{ name: 'Croissant-Rouge Algérien', url: 'https://www.cra-dz.org/' }] },
  saudi_arabia: { name: 'Saudi Arabia', iso2: 'SA', emergency: [n('Unified emergency number', '911'), n('Red Crescent ambulance', '997'), n('Civil defence', '998')], authorities: [{ name: 'National Center for Meteorology', url: 'https://ncm.gov.sa/' }, { name: 'General Directorate of Civil Defense', url: 'https://www.998.gov.sa/' }], relief: [{ name: 'Saudi Red Crescent Authority', url: 'https://www.srca.org.sa/' }] },
  united_arab_emirates: { name: 'United Arab Emirates', iso2: 'AE', emergency: [n('Police', '999'), n('Ambulance', '998'), n('Civil defence / fire', '997')], authorities: [{ name: 'National Center of Meteorology', url: 'https://www.ncm.gov.ae/' }, { name: 'NCEMA - emergency and crisis management', url: 'https://www.ncema.gov.ae/' }], relief: [{ name: 'Emirates Red Crescent', url: 'https://www.emiratesrc.ae/' }] },
  israel: { name: 'Israel', iso2: 'IL', emergency: [n('Police', '100'), n('Ambulance (Magen David Adom)', '101'), n('Fire and rescue', '102')], authorities: [{ name: 'Israel Meteorological Service', url: 'https://ims.gov.il/' }, { name: 'National Emergency Authority', url: 'https://www.gov.il/en/departments/rachel' }], relief: [{ name: 'Magen David Adom', url: 'https://www.mdais.org/en' }] },
  jordan: { name: 'Jordan', iso2: 'JO', emergency: [n('Emergency services', '911')], authorities: [{ name: 'Jordan Meteorological Department', url: 'http://jometeo.gov.jo/' }], relief: [{ name: 'Jordan National Red Crescent Society', url: 'https://www.jnrcs.org/' }] },
  iran: { name: 'Iran', iso2: 'IR', emergency: [n('Police', '110'), n('Emergency medical services', '115'), n('Fire', '125')], authorities: [{ name: 'Iran Meteorological Organization', url: 'https://www.irimo.ir/' }], relief: [{ name: 'Iranian Red Crescent Society', url: 'https://www.rcs.ir/' }] },
  iraq: { name: 'Iraq', iso2: 'IQ', emergency: [n('Police', '104'), n('Ambulance', '122'), n('Fire', '115')], authorities: [{ name: 'Iraqi Meteorological Organization', url: 'http://www.meteoseism.gov.iq/' }], relief: [{ name: 'Iraqi Red Crescent Society', url: 'https://www.ircs.org.iq/' }] },
  haiti: { name: 'Haiti', iso2: 'HT', emergency: [], authorities: [{ name: 'Direction Générale de la Protection Civile', url: 'https://www.protectioncivile.gouv.ht/' }], relief: [{ name: 'Croix-Rouge Haïtienne', url: 'https://www.croixrouge.ht/' }] },
  dominican_republic: { name: 'Dominican Republic', iso2: 'DO', emergency: [n('Emergency services', '911')], authorities: [{ name: 'ONAMET - meteorology', url: 'https://onamet.gob.do/' }, { name: 'Defensa Civil', url: 'https://defensacivil.gob.do/' }], relief: [{ name: 'Cruz Roja Dominicana', url: 'https://cruzroja.org.do/' }] },
  cuba: { name: 'Cuba', iso2: 'CU', emergency: [n('Police', '106'), n('Ambulance', '104'), n('Fire', '105')], authorities: [{ name: 'Instituto de Meteorología', url: 'http://www.insmet.cu/' }], relief: [{ name: 'Cuban Red Cross (via IFRC)', url: 'https://www.ifrc.org/national-societies-directory' }] },
  jamaica: { name: 'Jamaica', iso2: 'JM', emergency: [n('Police', '119'), n('Fire and ambulance', '110')], authorities: [{ name: 'ODPEM - disaster preparedness', url: 'https://www.odpem.org.jm/' }, { name: 'Meteorological Service Jamaica', url: 'https://metservice.gov.jm/' }], relief: [{ name: 'Jamaica Red Cross', url: 'https://www.jamaicaredcross.org/' }] },
  mozambique: { name: 'Mozambique', iso2: 'MZ', emergency: [], authorities: [{ name: 'INAM - national meteorology', url: 'https://www.inam.gov.mz/' }, { name: 'INGD - disaster management', url: 'https://www.ingd.gov.mz/' }], relief: [{ name: 'Cruz Vermelha de Moçambique', url: 'https://www.redcross.org.mz/' }] },
  madagascar: { name: 'Madagascar', iso2: 'MG', emergency: [], authorities: [{ name: 'BNGRC - disaster risk management', url: 'https://www.bngrc.mg/' }], relief: [{ name: 'Malagasy Red Cross (via IFRC)', url: 'https://www.ifrc.org/national-societies-directory' }] },
  zimbabwe: { name: 'Zimbabwe', iso2: 'ZW', emergency: [n('Emergency services', '999'), n('Emergency from a mobile phone', '112')], authorities: [{ name: 'Meteorological Services Department', url: 'https://www.weather.co.zw/' }], relief: [{ name: 'Zimbabwe Red Cross Society', url: 'https://www.redcrosszim.org.zw/' }] },
  zambia: { name: 'Zambia', iso2: 'ZM', emergency: [n('Police', '999')], authorities: [{ name: 'Zambia Meteorological Department', url: 'https://www.zmd.gov.zm/' }, { name: 'Disaster Management and Mitigation Unit', url: 'https://www.dmmu.gov.zm/' }], relief: [{ name: 'Zambia Red Cross Society', url: 'https://zambiaredcross.org/' }] }
};

/** Aliases and ISO codes that upstream feeds use instead of a plain country name. */
const COUNTRY_ALIASES = {
  usa: 'united_states', us: 'united_states', u_s_a: 'united_states', u_s: 'united_states',
  america: 'united_states', united_states_of_america: 'united_states', usa_: 'united_states',
  uk: 'united_kingdom', gb: 'united_kingdom', great_britain: 'united_kingdom', england: 'united_kingdom',
  scotland: 'united_kingdom', wales: 'united_kingdom', northern_ireland: 'united_kingdom',
  viet_nam: 'vietnam', vn: 'vietnam', vnm: 'vietnam',
  korea: 'south_korea', republic_of_korea: 'south_korea', korea_republic_of: 'south_korea', kor: 'south_korea',
  turkiye: 'turkey', tur: 'turkey',
  uae: 'united_arab_emirates', emirates: 'united_arab_emirates',
  czechia: 'czech_republic',
  ind: 'india', npl: 'nepal', idn: 'indonesia', phl: 'philippines', bgd: 'bangladesh', pak: 'pakistan',
  lka: 'sri_lanka', jpn: 'japan', chn: 'china', twn: 'taiwan', tha: 'thailand', mys: 'malaysia',
  sgp: 'singapore', khm: 'cambodia', mmr: 'myanmar', afg: 'afghanistan', can: 'canada', mex: 'mexico',
  bra: 'brazil', arg: 'argentina', chl: 'chile', col: 'colombia', per: 'peru', ecu: 'ecuador',
  gbr: 'united_kingdom', irl: 'ireland', fra: 'france', deu: 'germany', ita: 'italy', esp: 'spain',
  prt: 'portugal', grc: 'greece', nld: 'netherlands', bel: 'belgium', che: 'switzerland', aut: 'austria',
  pol: 'poland', nor: 'norway', swe: 'sweden', fin: 'finland', dnk: 'denmark', isl: 'iceland',
  ukr: 'ukraine', rus: 'russia', aus: 'australia', nzl: 'new_zealand', fji: 'fiji', png: 'papua_new_guinea',
  zaf: 'south_africa', ken: 'kenya', nga: 'nigeria', gha: 'ghana', eth: 'ethiopia', tza: 'tanzania',
  uga: 'uganda', mar: 'morocco', egy: 'egypt', tun: 'tunisia', dza: 'algeria', sau: 'saudi_arabia',
  are: 'united_arab_emirates', isr: 'israel', jor: 'jordan', irn: 'iran', irq: 'iraq', hti: 'haiti',
  dom: 'dominican_republic', cub: 'cuba', jam: 'jamaica', moz: 'mozambique', mdg: 'madagascar',
  zwe: 'zimbabwe', zmb: 'zambia', usa2: 'united_states'
};

/** Countries where 112 is the published emergency number even if not listed above. */
const EU_112 = [
  'albania', 'andorra', 'bosnia_and_herzegovina', 'bulgaria', 'croatia', 'cyprus', 'czech_republic',
  'estonia', 'georgia', 'hungary', 'kosovo', 'latvia', 'liechtenstein', 'lithuania', 'luxembourg',
  'malta', 'moldova', 'monaco', 'montenegro', 'north_macedonia', 'romania', 'san_marino', 'serbia',
  'slovakia', 'slovenia'
];

function countryKey(v) {
  return String(v == null ? '' : v)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

/** Resolve a raw country string (name, ISO2, ISO3 or alias) to a support record key. */
function resolveCountryKey(raw) {
  const k = countryKey(raw);
  if (!k) return '';
  if (COUNTRY_SUPPORT[k]) return k;
  if (COUNTRY_ALIASES[k]) return COUNTRY_ALIASES[k];
  // Feeds sometimes emit "Nepal, Bagmati" or "Indonesia (Java)".
  const first = k.split('_')[0];
  if (COUNTRY_SUPPORT[first]) return first;
  if (COUNTRY_ALIASES[first]) return COUNTRY_ALIASES[first];
  for (const key of Object.keys(COUNTRY_SUPPORT)) {
    if (k.startsWith(key) || key.startsWith(k)) return key;
  }
  return '';
}

/**
 * Build the support bundle for a country string.
 * Always returns a usable object; never throws, never invents a phone number.
 */
function supportFor(rawCountry, rawRegion) {
  const key = resolveCountryKey(rawCountry) || resolveCountryKey(rawRegion);
  const rec = key ? COUNTRY_SUPPORT[key] : null;
  const euKey = countryKey(rawCountry);
  const emergency = rec && rec.emergency && rec.emergency.length
    ? rec.emergency.slice()
    : EU_112.includes(euKey)
      ? [n('European emergency number', '112', 'Published single emergency number')]
      : [];

  return {
    matched: !!rec,
    countryKey: key,
    countryName: rec ? rec.name : (rawCountry || ''),
    emergency,
    authorities: rec ? (rec.authorities || []) : [],
    nationalRelief: rec ? (rec.relief || []) : [],
    globalRelief: GLOBAL_RELIEF,
    directories: GLOBAL_DIRECTORIES,
    fallbackNote: emergency.length
      ? 'Numbers shown are nationally published emergency numbers. Confirm on the linked official authority site before relying on them.'
      : 'No verified national emergency number is stored for this country. 112 reaches emergency services from a mobile phone in many countries, and 911 across North America - but confirm with the linked national authority or your local emergency service.'
  };
}

module.exports = {
  GLOBAL_RELIEF,
  GLOBAL_DIRECTORIES,
  COUNTRY_SUPPORT,
  COUNTRY_ALIASES,
  countryKey,
  resolveCountryKey,
  supportFor
};
