export const GLOBAL_RELIEF=[
{name:'IFRC / Red Cross Red Crescent',kind:'Emergency relief network',url:'https://www.ifrc.org/emergencies/all',donate:'https://www.ifrc.org/donate'},
{name:'UNICEF',kind:'Children and family emergency support',url:'https://www.unicef.org/emergencies',donate:'https://help.unicef.org/en/give-now'},
{name:'UN World Food Programme',kind:'Emergency food and logistics',url:'https://www.wfp.org/emergencies',donate:'https://www.wfp.org/support-us'},
{name:'UNHCR',kind:'Displacement and shelter support',url:'https://www.unhcr.org/emergencies',donate:'https://donate.unhcr.org/'},
{name:'UN Crisis Relief / CERF',kind:'UN humanitarian crisis funding',url:'https://crisisrelief.un.org/',donate:'https://crisisrelief.un.org/'}
];

export const COUNTRY_SUPPORT={
india:{authorities:[{name:'National Disaster Management Authority',url:'https://ndma.gov.in/'},{name:'India Meteorological Department',url:'https://mausam.imd.gov.in/'}],contacts:[{label:'Emergency Response Support System',phone:'112',url:'https://112.gov.in/'}]},
united_states:{authorities:[{name:'FEMA',url:'https://www.fema.gov/'},{name:'National Weather Service',url:'https://www.weather.gov/'}],contacts:[{label:'Emergency services',phone:'911',url:'https://www.usa.gov/emergency-services'}]},
canada:{authorities:[{name:'Public Safety Canada',url:'https://www.publicsafety.gc.ca/'},{name:'Environment Canada Weather',url:'https://weather.gc.ca/'}],contacts:[{label:'Emergency services',phone:'911',url:'https://www.canada.ca/en/services/policing/emergencies.html'}]},
australia:{authorities:[{name:'Australian Bureau of Meteorology',url:'https://www.bom.gov.au/'},{name:'Disaster Assist',url:'https://www.disasterassist.gov.au/'}],contacts:[{label:'Emergency services',phone:'000',url:'https://www.triplezero.gov.au/'}]},
new_zealand:{authorities:[{name:'National Emergency Management Agency',url:'https://www.civildefence.govt.nz/'},{name:'MetService',url:'https://www.metservice.com/'}],contacts:[{label:'Emergency services',phone:'111',url:'https://www.govt.nz/browse/law-crime-and-justice/emergencies/'}]},
japan:{authorities:[{name:'Japan Meteorological Agency',url:'https://www.jma.go.jp/jma/indexe.html'}],contacts:[{label:'Police',phone:'110',url:'https://www.npa.go.jp/english/'},{label:'Fire / Ambulance',phone:'119',url:'https://www.fdma.go.jp/en/'}]},
vietnam:{authorities:[{name:'National Center for Hydro-Meteorological Forecasting',url:'https://nchmf.gov.vn/'},{name:'Vietnam Disaster and Dyke Management Authority',url:'https://phongchongthientai.mard.gov.vn/'}],contacts:[]},
nepal:{authorities:[{name:'Department of Hydrology and Meteorology Nepal',url:'https://www.dhm.gov.np/'},{name:'Nepal Red Cross Society',url:'https://nrcs.org/'}],contacts:[]},
indonesia:{authorities:[{name:'BMKG Indonesia',url:'https://www.bmkg.go.id/'},{name:'BNPB Indonesia',url:'https://www.bnpb.go.id/'}],contacts:[]},
philippines:{authorities:[{name:'NDRRMC Philippines',url:'https://ndrrmc.gov.ph/'},{name:'PAGASA',url:'https://www.pagasa.dost.gov.ph/'}],contacts:[]},
pakistan:{authorities:[{name:'National Disaster Management Authority Pakistan',url:'https://www.ndma.gov.pk/'},{name:'Pakistan Meteorological Department',url:'https://www.pmd.gov.pk/'}],contacts:[]},
bangladesh:{authorities:[{name:'Department of Disaster Management Bangladesh',url:'https://ddm.gov.bd/'},{name:'Bangladesh Meteorological Department',url:'https://www.bmd.gov.bd/'}],contacts:[]}
};

export function countryKey(v=''){return String(v).trim().toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'')}
