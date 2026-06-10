// Asset type config
export const ASSET_TYPES = {
  pole:        { label: 'Pole',           icon: '🪧', color: '#8eafc2', bg: 'rgba(142,175,194,0.15)' },
  dtr:         { label: 'DTR',            icon: '🔆', color: '#f59e0b', bg: 'rgba(245,158,11,0.15)'  },
  meter:       { label: 'Consumer Meter', icon: '🔌', color: '#10b981', bg: 'rgba(16,185,129,0.15)'  },
  line:        { label: 'Line Span',      icon: '📏', color: '#3b82f6', bg: 'rgba(59,130,246,0.15)'  },
  pillar:      { label: 'Feeder Pillar',  icon: '🔐', color: '#a855f7', bg: 'rgba(168,85,247,0.15)'  },
  iso:         { label: 'Isolator',       icon: '🔴', color: '#f43f5e', bg: 'rgba(244,63,94,0.15)'   },
  linedp:      { label: 'Line DP',         icon: '🔀', color: '#84cc16', bg: 'rgba(132,204,22,0.15)'   },
}

export const ROLES = {
  feeder_incharge: { label: 'Feeder Incharge', short: 'FI',  color: '#3b82f6', bg: 'rgba(59,130,246,0.15)'  },
  je:              { label: 'Junior Engineer',  short: 'JE',  color: '#10b981', bg: 'rgba(16,185,129,0.15)'  },
  ao:              { label: 'Accounts Officer', short: 'AO',  color: '#f59e0b', bg: 'rgba(245,158,11,0.15)'  },
  sdo:             { label: 'SDO',              short: 'SDO', color: '#a855f7', bg: 'rgba(168,85,247,0.15)'  },
  admin:           { label: 'Admin',            short: 'ADM', color: '#ef4444', bg: 'rgba(239,68,68,0.15)'   },
}

export const CONDUCTORS = [
  { label: 'ACSR Weasel',   weight: 0.394, tension: 300 },
  { label: 'ACSR Dog',      weight: 0.614, tension: 500 },
  { label: 'ACSR Rabbit',   weight: 0.277, tension: 200 },
  { label: 'ACSR Panther',  weight: 0.977, tension: 800 },
  { label: 'AAAC (custom)', weight: 0.394, tension: 300 },
]

export const IE_CLEARANCE = { 'HT 11kV': 4.6, 'HT 33kV': 5.2, 'LT': 3.7 }

export const INDIAN_STATES = [
  'Andhra Pradesh','Assam','Bihar','Chhattisgarh','Delhi','Gujarat',
  'Haryana','Himachal Pradesh','Jammu & Kashmir','Jharkhand','Karnataka',
  'Kerala','Madhya Pradesh','Maharashtra','Odisha','Punjab',
  'Rajasthan','Tamil Nadu','Telangana','Uttar Pradesh','Uttarakhand',
  'West Bengal','Other',
]

export const PRIORITY_COLORS = {
  urgent: '#ef4444', high: '#f97316', normal: '#3b82f6', low: '#6b7280',
}

export const STATUS_COLORS = {
  ok: '#10b981', flag: '#f59e0b', fault: '#ef4444',
  open: '#3b82f6', assigned: '#a855f7', closed: '#6b7280',
  draft: '#6b7280', submitted: '#f59e0b', approved: '#10b981', rejected: '#ef4444',
}

// GPS helpers
export const GPS_GOOD = 10
export const GPS_OK   = 25

export function gpsColorClass(acc) {
  if (acc <= GPS_GOOD) return '#10b981'
  if (acc <= GPS_OK)   return '#f59e0b'
  return '#ef4444'
}

// Haversine distance in metres
export function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000
  const toR = d => d * Math.PI / 180
  const dLat = toR(lat2-lat1), dLng = toR(lng2-lng1)
  const a = Math.sin(dLat/2)**2 + Math.cos(toR(lat1))*Math.cos(toR(lat2))*Math.sin(dLng/2)**2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
}

// Sag calculator
export function calcSag({ span, conductorWeight, tension, windLoad = 0.18 }) {
  const sag = conductorWeight * span * span / (8 * tension)
  const sagR = Math.sqrt(conductorWeight**2 + windLoad**2) * span * span / (8 * tension)
  return { sag: +sag.toFixed(2), sagResultant: +sagR.toFixed(2) }
}

export function sagVerdict(groundClearance, lineType) {
  const min = IE_CLEARANCE[lineType] || 3.7
  if (groundClearance < min)       return { verdict: 'critical', color: '#ef4444' }
  if (groundClearance < min + 0.5) return { verdict: 'warning',  color: '#f59e0b' }
  return                                  { verdict: 'ok',       color: '#10b981' }
}

// Outstanding formatting
export function fmtOut(amount) {
  if (!amount || amount <= 0) return null
  if (amount >= 100000) return `₹${(amount/100000).toFixed(1)}L`
  if (amount >= 1000)   return `₹${Math.round(amount/1000)}K`
  return `₹${amount.toLocaleString('en-IN')}`
}

export function outColor(amount) {
  if (amount >= 100000) return '#ef4444'
  if (amount >= 50000)  return '#f97316'
  if (amount >= 10000)  return '#f59e0b'
  return '#10b981'
}

// WhatsApp helpers
export function waOpen(msg) {
  window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank')
}

export function buildWOMessage(wo, assets, org) {
  const nl = '\n'
  const lines = [
    `*${org.name} ${org.city} — Work Order*`,
    `——————————————`,
    `*WO No.:* ${wo.wo_number}`,
    `*Title:* ${wo.title}`,
    `*Issue:* ${wo.issue_type || '–'}`,
    `*Priority:* ${(wo.priority||'normal').toUpperCase()}`,
    `*Status:* ${(wo.status||'open').toUpperCase()}`,
    `*Due:* ${wo.due_date || '–'}`,
    (wo.profiles?.name||wo.assigned_name) ? `*Assigned:* ${wo.profiles?.name||wo.assigned_name}` : null,
    `——————————————`,
    `*Assets (${assets.length}):*`,
    ...assets.map(a => `• ${a.name} (${ASSET_TYPES[a.asset_type]?.label||a.asset_type}): ${parseFloat(a.latitude).toFixed(5)}N, ${parseFloat(a.longitude).toFixed(5)}E`),
    assets[0] ? `\n📍 https://maps.google.com/?q=${assets[0].latitude},${assets[0].longitude}` : null,
    wo.remarks ? `\n*Remarks:* ${wo.remarks}` : null,
    `\n_${org.name} ${org.division}_`,
  ].filter(Boolean).join(nl)
  return lines
}

export function buildGroupMessage(group, meters, org) {
  const nl = '\n'
  const totalOut = meters.reduce((s,m) => s+(m.outstanding_amount||0), 0)
  const top5 = [...meters].sort((a,b)=>(b.outstanding_amount||0)-(a.outstanding_amount||0)).slice(0,5)
  const lines = [
    `*${org.name} ${org.city} — Recovery Notice*`,
    `*Group: ${group.name}*`, '',
    `Total Consumers: ${meters.length}`,
    `Total Outstanding: Rs.${totalOut.toLocaleString('en-IN')}`, '',
    `*Top Defaulters:*`,
    ...top5.flatMap((m,i) => [
      `${i+1}. ${m.details?.consumer_name||m.name} (${m.name})`,
      `   Rs.${(m.outstanding_amount||0).toLocaleString('en-IN')}`,
      `   ${parseFloat(m.latitude).toFixed(5)}N, ${parseFloat(m.longitude).toFixed(5)}E`,
      m.mobile ? `   Mobile: ${m.mobile}` : null,
    ].filter(Boolean)),
    `\n_${org.name} ${org.division}_`,
  ].join(nl)
  return lines
}

export function buildConsumerNotice(meter, org) {
  return `${org.name} ${org.city}: Dear ${meter.details?.consumer_name||'Consumer'}, Your K.No. ${meter.name} has outstanding Rs.${(meter.outstanding_amount||0).toLocaleString('en-IN')}. Please clear dues at nearest ${org.name} office. -${org.name} ${org.city}`
}
