import { useEffect, useState } from 'react'
import { useAssetStore, useFeederStore, useAuthStore, useUIStore } from '../store/index.js'
import { maintenanceApi, auditApi, hierarchyApi } from '../api/client.js'
import { ASSET_TYPES } from '../utils/constants.js'

const STATUS_CONFIG = {
  draft:      { label: 'Draft',        color: '#6b7280', next: 'je_review',  nextLabel: 'Submit to JE',      role: 'feeder_incharge' },
  je_review:  { label: 'JE Review',    color: '#3b82f6', next: 'sdo_review', nextLabel: 'Submit to SDO',     role: 'je'              },
  sdo_review: { label: 'SDO Review',   color: '#a855f7', next: 'ee_review',  nextLabel: 'Forward to EE',     role: 'sdo'             },
  ee_review:  { label: 'EE Review',    color: '#f97316', next: 'se_review',  nextLabel: 'Forward to SE',     role: 'ee'              },
  se_review:  { label: 'SE Review',    color: '#ef4444', next: 'approved',   nextLabel: 'Approve & Generate PDF', role: 'se'         },
  approved:   { label: 'Approved',     color: '#10b981', next: null,         nextLabel: null,                role: null              },
  hold:       { label: 'On Hold',      color: '#f59e0b', next: 'se_review',  nextLabel: 'Resubmit to SE',    role: 'se'              },
  rejected:   { label: 'Sent Back',    color: '#f59e0b', next: null,         nextLabel: null,                role: null              },
}

const REJECT_TO = {
  je_review:  { status: 'draft',      label: 'Send Back to FI'  },
  sdo_review: { status: 'je_review',  label: 'Send Back to JE'  },
  ee_review:  { status: 'sdo_review', label: 'Send Back to SDO' },
  se_review:  { status: 'ee_review',  label: 'Send Back to EE'  },
}

const ISSUE_TYPES = {
  pole:   ['Tilted Pole','Broken Pole','Rusted Pole','No Earthing','Leaning Pole','Other'],
  dtr:    ['DTR Burnt','DTR Failed','DTR Overloaded','Oil Leakage','Bushing Cracked','Other'],
  line:   ['Line Sag','Conductor Break','Loose Joint','Insulation Damage','Tree Touching','Other'],
  iso:    ['Faulty Isolator','Broken Disc','Flashover Marks','Other'],
  meter:  ['Meter Bypass','Meter Broken','No Display','Other'],
  pillar: ['Door Missing','Fuse Blown','Other'],
  linedp: ['Physical Damage','Loose Connection','Other'],
  default:['Physical Damage','Maintenance Required','Replacement Required','Other'],
}

const SEV_COLOR = { low:'#6b7280', medium:'#f59e0b', high:'#f97316', critical:'#ef4444' }

export default function MaintenancePage() {
  const { assets } = useAssetStore()
  const { feeders } = useFeederStore()
  const { profile, org, isAdmin } = useAuthStore()
  const { toast } = useUIStore()
  const [subdivisions, setSubdivisions] = useState([])

  const [proposals, setProposals] = useState([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState('list')   // list | detail | new
  const [selected, setSelected] = useState(null)
  const [filter, setFilter] = useState('all')
  const [saving, setSaving] = useState(false)

  // New proposal form
  const [newForm, setNewForm] = useState({ feederId:'', subdivisionId:'', title:'', description:'', priority:'normal' })

  // Add item form (in detail view)
  const [itemForm, setItemForm] = useState(null)

  // Stage action state
  const [stageRemarks, setStageRemarks] = useState('')
  const [rejectReason, setRejectReason] = useState('')
  const [showReject, setShowReject] = useState(false)
  const [showAO, setShowAO] = useState(false)
  const [aoBudgetNote, setAOBudgetNote] = useState('')
  const [aoBudgetStatus, setAOBudgetStatus] = useState('provisionally_approved')

  useEffect(() => {
    loadProposals()
    hierarchyApi.listDivisions()
      .then(divs => setSubdivisions(divs.flatMap(d => d.subdivisions || [])))
      .catch(() => {})
  }, [])

  async function loadProposals() {
    setLoading(true)
    try { const data = await maintenanceApi.list(); setProposals(data) }
    catch(e) { toast(e.message,'err') }
    finally { setLoading(false) }
  }

  async function openDetail(p) {
    try {
      const full = await maintenanceApi.get(p.id)
      setSelected(full)
      setView('detail')
    } catch(e) { toast(e.message,'err') }
  }

  async function createProposal() {
    if (!newForm.feederId || !newForm.title) return toast('Feeder and title required','err')
    const feeder = feeders.find(f => f.id === newForm.feederId)
    const subdivisionId = feeder?.subdivision_id || newForm.subdivisionId
    if (!subdivisionId) return toast('Select a sub-division for this feeder','err')
    setSaving(true)
    try {
      const p = await maintenanceApi.create({
        feederId: newForm.feederId,
        subdivisionId,
        title: newForm.title,
        description: newForm.description,
        priority: newForm.priority,
        createdById: profile?.id,
      })
      await auditApi.log({ action:'MAINTENANCE_CREATED', category:'asset', severity:'info',
        description:`Maintenance proposal ${p.proposal_number} created`, meta:{id:p.id} })
      setProposals(prev => [p, ...prev])
      setNewForm({ feederId:'', title:'', description:'', priority:'normal' })
      setView('list')
      toast('✅ ' + p.proposal_number + ' created','ok')
    } catch(e) { toast(e.message,'err') } finally { setSaving(false) }
  }

  async function addItem() {
    if (!itemForm?.assetId || !itemForm?.issueType) return toast('Select asset and issue','err')
    const asset = assets.find(a => a.id === itemForm.assetId)
    setSaving(true)
    try {
      const item = await maintenanceApi.addItem(selected.id, {
        asset_id: itemForm.assetId,
        asset_code: asset?.asset_code,
        asset_type: asset?.asset_type,
        asset_name: asset?.name,
        issue_type: itemForm.issueType,
        issue_description: itemForm.description,
        severity: itemForm.severity || 'medium',
        tagged_by_id: profile?.id,
      })
      setSelected(prev => ({ ...prev, items: [...(prev.items||[]), item] }))
      setItemForm(null)
      toast('✅ Asset tagged','ok')
    } catch(e) { toast(e.message,'err') } finally { setSaving(false) }
  }

  async function removeItem(item) {
    if (!confirm('Remove this item from proposal?')) return
    try {
      await maintenanceApi.removeItem(item.id)
      setSelected(prev => ({ ...prev, items: prev.items.filter(i=>i.id!==item.id) }))
      toast('Item removed','ok')
    } catch(e) { toast(e.message,'err') }
  }

  async function verifyItem(item, verified) {
    const note = verified ? '' : prompt('JE note (reason for removal):') || ''
    try {
      const updated = await maintenanceApi.jeVerifyItem(item.id, verified, note)
      setSelected(prev => ({ ...prev, items: prev.items.map(i=>i.id===item.id?{...i,...updated}:i) }))
    } catch(e) { toast(e.message,'err') }
  }

  async function advanceStage() {
    if (!selected) return
    const cfg = STATUS_CONFIG[selected.status]
    if (!cfg?.next) return
    setSaving(true)
    try {
      const updated = await maintenanceApi.advance(selected.id, cfg.next, stageRemarks, profile?.id)
      setSelected(prev => ({ ...prev, ...updated }))
      setProposals(prev => prev.map(p => p.id===selected.id ? {...p,...updated} : p))
      await auditApi.log({ action:'MAINTENANCE_ADVANCED', category:'asset', severity:'info',
        description:`${selected.proposal_number} → ${cfg.next}`, meta:{id:selected.id} })
      setStageRemarks('')
      toast(`✅ Submitted — status: ${cfg.next}`,'ok')
      if (cfg.next === 'approved') generatePDF(selected)
    } catch(e) { toast(e.message,'err') } finally { setSaving(false) }
  }

  async function rejectStage() {
    if (!rejectReason.trim()) return toast('Enter rejection reason','err')
    const rejectTo = REJECT_TO[selected.status]
    if (!rejectTo) return
    setSaving(true)
    try {
      const updated = await maintenanceApi.reject(selected.id, rejectTo.status, rejectReason, profile?.id)
      setSelected(prev => ({ ...prev, ...updated }))
      setProposals(prev => prev.map(p => p.id===selected.id ? {...p,...updated} : p))
      await auditApi.log({ action:'MAINTENANCE_REJECTED', category:'asset', severity:'warn',
        description:`${selected.proposal_number} sent back to ${rejectTo.status}: ${rejectReason}`,
        meta:{id:selected.id} })
      setShowReject(false); setRejectReason('')
      toast('↩ Sent back with remarks','warn')
    } catch(e) { toast(e.message,'err') } finally { setSaving(false) }
  }

  async function aoReview() {
    setSaving(true)
    try {
      const updated = await maintenanceApi.aoReview(selected.id, aoBudgetStatus, aoBudgetNote, profile?.id)
      setSelected(prev => ({ ...prev, ...updated }))
      setShowAO(false)
      toast(aoBudgetStatus==='provisionally_approved' ? '✅ Budget provisionally approved' : '📋 Budget note added','ok')
    } catch(e) { toast(e.message,'err') } finally { setSaving(false) }
  }

  async function holdProposal() {
    try {
      const updated = await maintenanceApi.advance(selected.id, 'hold', 'Put on hold pending budget', profile?.id)
      setSelected(prev => ({ ...prev, ...updated }))
      setProposals(prev => prev.map(p => p.id===selected.id ? {...p,...updated} : p))
      toast('📦 Proposal put on hold','warn')
    } catch(e) { toast(e.message,'err') }
  }

  async function generatePDF(proposal) {
    try {
      const full = proposal.items ? proposal : await maintenanceApi.get(proposal.id)
      const { jsPDF } = await import('jspdf').then(m => ({ jsPDF: m.jsPDF||m.default?.jsPDF||m.default }))
      const doc = new jsPDF({ orientation:'portrait', unit:'mm', format:'a4' })
      const W = 210, M = 14

      // Header
      doc.setFillColor(7,16,30); doc.rect(0,0,W,38,'F')
      doc.setTextColor(0,212,255); doc.setFontSize(14); doc.setFont('helvetica','bold')
      doc.text(`${org?.name} — ${org?.division}`, W/2, 12, { align:'center' })
      doc.setFontSize(11); doc.setTextColor(255,255,255)
      doc.text('ASSET MAINTENANCE PROPOSAL', W/2, 21, { align:'center' })
      doc.setFontSize(9); doc.setTextColor(180,200,220)
      doc.text(full.proposal_number, W/2, 29, { align:'center' })

      // Proposal details
      let y = 46
      const meta = [
        ['Proposal No.', full.proposal_number],
        ['Title', full.title],
        ['Feeder', `${full.feeders?.code} — ${full.feeders?.name}`],
        ['Sub-Division', `${full.subdivisions?.code} — ${full.subdivisions?.name}`],
        ['Priority', (full.priority||'').toUpperCase()],
        ['Status', (full.status||'').replace(/_/g,' ').toUpperCase()],
        ['Created By', full.profiles?.name || '—'],
        ['Date', new Date(full.created_at).toLocaleDateString('en-IN',{day:'2-digit',month:'long',year:'numeric'})],
      ]
      doc.setFontSize(8)
      meta.forEach(([k,v],i) => {
        const x = i%2===0 ? M : W/2
        if (i%2===0) y += 6
        doc.setFont('helvetica','bold'); doc.setTextColor(80,80,80); doc.text(k+':', x, y)
        doc.setFont('helvetica','normal'); doc.setTextColor(20,20,20); doc.text(String(v||'—'), x+40, y)
      })

      // AO Budget Note
      if (full.ao_budget_note) {
        y += 10
        const aoColor = full.ao_budget_status==='provisionally_approved' ? [16,185,129] : [245,158,11]
        doc.setFillColor(...aoColor); doc.roundedRect(M, y-4, W-2*M, 10, 2, 2, 'F')
        doc.setFont('helvetica','bold'); doc.setTextColor(255,255,255); doc.setFontSize(8)
        doc.text(`AO Budget Note (${full.ao_budget_status?.replace(/_/g,' ').toUpperCase()}): ${full.ao_budget_note}`, M+3, y+2)
      }

      // Items table
      y += 14
      doc.setFillColor(7,16,30); doc.rect(M, y-5, W-2*M, 8,'F')
      doc.setFont('helvetica','bold'); doc.setTextColor(0,212,255); doc.setFontSize(7.5)
      const cols = ['#','Asset Code','Type','Issue','Severity','Description','JE Verified']
      const cw = [7,22,18,32,16,55,22]
      let cx = M
      cols.forEach((c,i) => { doc.text(c, cx+1, y); cx+=cw[i] })
      y+=3

      doc.setFont('helvetica','normal'); doc.setTextColor(20,20,20)
      const activeItems = (full.items||[]).filter(i=>!i.removed_by_je)
      activeItems.forEach((item,idx) => {
        y += 6.5
        if (y > 265) { doc.addPage(); y = 20 }
        if (idx%2===0) { doc.setFillColor(248,250,252); doc.rect(M,y-4.5,W-2*M,6.5,'F') }
        const sevColor = SEV_COLOR[item.severity]||'#888'
        const [r,g,b] = sevColor.replace('#','').match(/.{2}/g).map(h=>parseInt(h,16))
        doc.setFillColor(r,g,b); doc.circle(M+3.5,y-1,1.5,'F')
        cx = M
        doc.setFontSize(7)
        const row = [
          String(item.seq_number||idx+1),
          item.asset_code||'—',
          ASSET_TYPES[item.asset_type]?.label||item.asset_type||'—',
          item.issue_type||'—',
          (item.severity||'').toUpperCase(),
          (item.issue_description||'').slice(0,60),
          item.je_verified ? '✓ Yes' : '—',
        ]
        row.forEach((v,i) => {
          doc.setTextColor(i===6&&item.je_verified?0:20, i===6&&item.je_verified?150:20, i===6&&item.je_verified?0:20)
          doc.text(String(v), cx+1, y)
          cx+=cw[i]
        })
      })

      // Stage remarks
      y += 12
      if (y > 240) { doc.addPage(); y = 20 }
      doc.setFont('helvetica','bold'); doc.setFontSize(9); doc.setTextColor(30,60,90)
      doc.text('STAGE-WISE REMARKS', M, y); y+=6
      const remarks = [
        ['FI', full.fi_remarks], ['JE', full.je_remarks],
        ['SDO', full.sdo_remarks], ['EE', full.ee_remarks], ['SE', full.se_remarks],
      ].filter(([,v])=>v)
      remarks.forEach(([stage,rem]) => {
        doc.setFont('helvetica','bold'); doc.setFontSize(7); doc.setTextColor(80,80,80)
        doc.text(stage+':', M, y)
        doc.setFont('helvetica','normal'); doc.setTextColor(20,20,20)
        doc.text(rem||'—', M+12, y)
        y+=5
      })

      // Footer
      doc.setFontSize(7); doc.setTextColor(150,150,150)
      doc.text(`${full.proposal_number} · ${org?.name} · Generated: ${new Date().toLocaleString('en-IN')}`, W/2, 285, {align:'center'})

      doc.save(`${full.proposal_number.replace(/\//g,'-')}_Maintenance.pdf`)
      toast('📄 PDF downloaded','ok')
    } catch(e) { console.error(e); toast('PDF error: '+e.message,'err') }
  }

  const canAct = (p) => {
    const cfg = STATUS_CONFIG[p?.status]
    if (!cfg) return false
    if (['admin','se'].includes(profile?.role)) return true
    return cfg.role === profile?.role
  }

  const canAO = profile?.role === 'ao' && selected?.status === 'se_review'

  const filtered = proposals.filter(p => {
    if (filter === 'all') return true
    if (filter === 'mine') return p.created_by_id === profile?.id || p.current_owner_id === profile?.id
    return p.status === filter
  })

  const inp = "w-full bg-bg border border-bd rounded-xl px-3 py-2.5 text-sm text-tx focus:outline-none focus:border-a"

  // ── LIST VIEW ──────────────────────────────────────────────
  if (view === 'list') return (
    <div className="h-full flex flex-col">
      <div className="p-4 pb-2 flex-shrink-0 border-b border-bd flex items-center justify-between">
        <div>
          <div className="font-rajdhani font-bold text-sm">🔧 Asset Maintenance</div>
          <div className="text-[10px] text-mu mt-0.5">{proposals.length} proposals</div>
        </div>
        {['feeder_incharge','je','admin'].includes(profile?.role) && (
          <button onClick={()=>setView('new')}
            className="px-3 py-2 rounded-xl bg-a/10 border border-a/30 text-a text-xs font-bold">
            + New Proposal
          </button>
        )}
      </div>

      {/* Filter chips */}
      <div className="px-3 py-2 flex gap-1.5 overflow-x-auto flex-shrink-0 border-b border-bd/50">
        {[['all','All'],['mine','My Cases'],['draft','Draft'],['je_review','JE'],
          ['sdo_review','SDO'],['ee_review','EE'],['se_review','SE'],
          ['approved','Approved'],['hold','On Hold']].map(([id,label])=>(
          <button key={id} onClick={()=>setFilter(id)}
            className={`flex-shrink-0 text-[10px] font-bold px-2.5 py-1.5 rounded-full border transition-colors
              ${filter===id?'bg-a text-bg border-a':'border-bd text-mu'}`}>
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {loading && <div className="text-center py-8 text-mu text-sm animate-pulse">Loading…</div>}
        {!loading && filtered.length===0 && (
          <div className="text-center py-12 text-mu">
            <div className="text-4xl mb-3">🔧</div>
            <div className="text-sm">No proposals found</div>
          </div>
        )}
        {filtered.map(p => {
          const cfg = STATUS_CONFIG[p.status]
          return (
            <div key={p.id} className="bg-sf border border-bd rounded-2xl p-4 cursor-pointer hover:border-a/50 transition-colors"
              onClick={()=>openDetail(p)}>
              <div className="flex items-start justify-between mb-2">
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-xs text-a font-bold">{p.proposal_number}</div>
                  <div className="font-semibold text-sm mt-0.5 truncate">{p.title}</div>
                  <div className="text-[10px] text-mu mt-0.5">⚡ {p.feeders?.code} · {p.subdivisions?.code}</div>
                </div>
                <span className="text-[9px] font-bold px-2 py-1 rounded-full flex-shrink-0 ml-2"
                  style={{background:cfg?.color+'22',color:cfg?.color}}>
                  {cfg?.label}
                </span>
              </div>
              <div className="flex items-center justify-between text-[10px] text-mu">
                <span>By {p.profiles?.name}</span>
                <span>{new Date(p.created_at).toLocaleDateString('en-IN')}</span>
              </div>
              {p.rejection_reason && (
                <div className="mt-2 text-[10px] text-amber-400 bg-amber-500/10 rounded-lg px-2 py-1">
                  ↩ {p.rejection_reason}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )

  // ── NEW PROPOSAL ───────────────────────────────────────────
  if (view === 'new') return (
    <div className="h-full flex flex-col p-4">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={()=>setView('list')} className="text-mu text-sm">← Back</button>
        <div className="font-rajdhani font-bold text-a">New Maintenance Proposal</div>
      </div>
      <div className="flex-1 overflow-y-auto space-y-3">
        <div>
          <label className="text-[10px] text-mu block mb-1">Feeder *</label>
          <select className={inp} value={newForm.feederId}
            onChange={e=>setNewForm({...newForm, feederId:e.target.value, subdivisionId:''})}>
            <option value="">Select feeder…</option>
            {feeders.map(f=><option key={f.id} value={f.id}>{f.code} — {f.name}</option>)}
          </select>
        </div>
        {/* Show subdivision selector if feeder has no subdivision linked */}
        {newForm.feederId && !feeders.find(f=>f.id===newForm.feederId)?.subdivision_id && (
          <div>
            <label className="text-[10px] text-mu block mb-1">Sub-Division * <span className="text-amber-400">(feeder not linked — select manually)</span></label>
            <select className={inp} value={newForm.subdivisionId}
              onChange={e=>setNewForm({...newForm, subdivisionId:e.target.value})}>
              <option value="">Select sub-division…</option>
              {subdivisions.map(s=><option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
            </select>
            <div className="text-[10px] text-amber-400 mt-1">
              ⚠️ Also link this feeder to its sub-division in the Feeders tab for future proposals
            </div>
          </div>
        )}
        {newForm.feederId && feeders.find(f=>f.id===newForm.feederId)?.subdivision_id && (
          <div className="text-[10px] text-green-400 px-1">
            ✅ Sub-Division: {subdivisions.find(s=>s.id===feeders.find(f=>f.id===newForm.feederId)?.subdivision_id)?.name || 'Linked'}
          </div>
        )}
        <div>
          <label className="text-[10px] text-mu block mb-1">Title *</label>
          <input className={inp} placeholder="e.g. Annual maintenance — F1 Jhalawar"
            value={newForm.title} onChange={e=>setNewForm({...newForm,title:e.target.value})} />
        </div>
        <div>
          <label className="text-[10px] text-mu block mb-1">Description</label>
          <textarea className={inp} rows={3} placeholder="Describe scope of maintenance…"
            value={newForm.description} onChange={e=>setNewForm({...newForm,description:e.target.value})} />
        </div>
        <div>
          <label className="text-[10px] text-mu block mb-1">Priority</label>
          <select className={inp} value={newForm.priority} onChange={e=>setNewForm({...newForm,priority:e.target.value})}>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
            <option value="low">Low</option>
          </select>
        </div>
        <div className="bg-sf2 border border-bd rounded-xl p-3 text-[10px] text-mu">
          📋 Proposal number will be auto-generated as:<br/>
          <span className="font-mono text-a">FeederCode / SubDivCode / Year / Sequence</span><br/>
          e.g. <span className="font-mono text-a">{feeders.find(f=>f.id===newForm.feederId)?.code||'F1'}/SD-01/{new Date().getFullYear()}/0001</span>
        </div>
      </div>
      <div className="flex gap-3 mt-4 flex-shrink-0">
        <button onClick={()=>setView('list')} className="px-6 py-3 rounded-xl border border-bd text-mu font-bold">Cancel</button>
        <button onClick={createProposal} disabled={saving}
          className="flex-1 py-3 rounded-xl bg-gradient-to-r from-a to-blue-500 text-bg font-rajdhani font-bold disabled:opacity-50">
          {saving?'⏳…':'🔧 Create Proposal'}
        </button>
      </div>
    </div>
  )

  // ── DETAIL VIEW ────────────────────────────────────────────
  if (view === 'detail' && selected) {
    const cfg = STATUS_CONFIG[selected.status]
    const rejectCfg = REJECT_TO[selected.status]
    const activeItems = (selected.items||[]).filter(i=>!i.removed_by_je)
    const feederAssets = assets.filter(a=>a.feeder_id===selected.feeder_id)
    const issueOptions = itemForm ? (ISSUE_TYPES[itemForm.assetType]||ISSUE_TYPES.default) : []
    const myTurn = canAct(selected)
    const myTurnAO = canAO

    return (
      <div className="h-full flex flex-col">
        {/* Header */}
        <div className="p-3 border-b border-bd flex-shrink-0">
          <div className="flex items-center gap-2 mb-2">
            <button onClick={()=>{setView('list');setSelected(null)}} className="text-mu text-sm">←</button>
            <div className="flex-1 min-w-0">
              <div className="font-mono text-xs text-a font-bold">{selected.proposal_number}</div>
              <div className="font-semibold text-sm truncate">{selected.title}</div>
            </div>
            <span className="text-[9px] font-bold px-2 py-1 rounded-full flex-shrink-0"
              style={{background:cfg?.color+'22',color:cfg?.color}}>{cfg?.label}</span>
          </div>
          {/* Pipeline indicator */}
          <div className="flex items-center gap-1 overflow-x-auto">
            {['draft','je_review','sdo_review','ee_review','se_review','approved'].map((s,i)=>{
              const done = ['draft','je_review','sdo_review','ee_review','se_review','approved'].indexOf(selected.status) >= i
              const active = selected.status === s
              return (
                <div key={s} className="flex items-center gap-1 flex-shrink-0">
                  <div className={`text-[8px] font-bold px-1.5 py-0.5 rounded ${active?'bg-a text-bg':done?'bg-green-500/20 text-green-400':'bg-bd text-mu'}`}>
                    {s.replace('_review','').replace('draft','FI').toUpperCase()}
                  </div>
                  {i<5&&<div className="w-3 h-px bg-bd"/>}
                </div>
              )
            })}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {/* Info */}
          <div className="bg-sf border border-bd rounded-2xl p-4 text-xs space-y-1">
            <div className="flex justify-between"><span className="text-mu">Feeder</span><span>⚡ {selected.feeders?.code} — {selected.feeders?.name}</span></div>
            <div className="flex justify-between"><span className="text-mu">Sub-Division</span><span>{selected.subdivisions?.code}</span></div>
            <div className="flex justify-between"><span className="text-mu">Priority</span><span className="font-bold" style={{color:selected.priority==='urgent'?'#ef4444':selected.priority==='high'?'#f97316':'#3b82f6'}}>{(selected.priority||'').toUpperCase()}</span></div>
            <div className="flex justify-between"><span className="text-mu">Created by</span><span>{selected.profiles?.name}</span></div>
            {selected.description && <div className="pt-1 text-mu border-t border-bd">{selected.description}</div>}
          </div>

          {/* AO Budget Status */}
          {selected.ao_budget_note && (
            <div className={`rounded-2xl p-3 border text-xs ${selected.ao_budget_status==='provisionally_approved'?'bg-green-500/10 border-green-500/30':'bg-amber-500/10 border-amber-500/30'}`}>
              <div className="font-bold mb-1" style={{color:selected.ao_budget_status==='provisionally_approved'?'#10b981':'#f59e0b'}}>
                💰 AO Budget Note: {selected.ao_budget_status?.replace(/_/g,' ').toUpperCase()}
              </div>
              <div className="text-mu">{selected.ao_budget_note}</div>
              <div className="text-[10px] text-mu mt-1">Note: This is provisional — final sanction is a separate procedure</div>
            </div>
          )}

          {/* Rejection info */}
          {selected.rejection_reason && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-3 text-xs">
              <div className="font-bold text-amber-400 mb-1">↩ Sent Back</div>
              <div className="text-mu">{selected.rejection_reason}</div>
            </div>
          )}

          {/* Items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="font-rajdhani font-bold text-xs text-a">TAGGED ASSETS ({activeItems.length})</div>
              {(selected.status==='draft' || (selected.status==='je_review'&&profile?.role==='je')) &&
               (selected.status==='draft' ? profile?.role==='feeder_incharge'||isAdmin() : true) && (
                <button onClick={()=>setItemForm({assetId:'',assetType:'',issueType:'',description:'',severity:'medium'})}
                  className="px-2 py-1 rounded-lg bg-a/10 border border-a/30 text-a text-[10px] font-bold">
                  + Tag Asset
                </button>
              )}
            </div>
            <div className="space-y-2">
              {(selected.items||[]).map(item => (
                <div key={item.id} className={`rounded-xl border p-3 text-xs ${item.removed_by_je?'opacity-40 border-red-500/20':'border-bd bg-sf'}`}>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <span className="text-base">{ASSET_TYPES[item.asset_type]?.icon}</span>
                      <div className="min-w-0">
                        <div className="font-bold truncate">{item.asset_code} — {item.asset_name}</div>
                        <div className="text-mu">{item.issue_type}</div>
                        {item.issue_description&&<div className="text-mu mt-0.5">{item.issue_description}</div>}
                      </div>
                    </div>
                    <div className="flex gap-1 flex-shrink-0 ml-2">
                      <span className="text-[8px] font-bold px-1.5 py-0.5 rounded"
                        style={{background:SEV_COLOR[item.severity]+'22',color:SEV_COLOR[item.severity]}}>
                        {item.severity?.toUpperCase()}
                      </span>
                      {selected.status==='je_review'&&profile?.role==='je'&&!item.removed_by_je&&(
                        <>
                          <button onClick={()=>verifyItem(item,true)}
                            className={`w-6 h-6 rounded-lg border text-[9px] ${item.je_verified?'bg-green-500/20 border-green-500/40 text-green-400':'border-bd text-mu'}`}>✓</button>
                          <button onClick={()=>verifyItem(item,false)}
                            className="w-6 h-6 rounded-lg border border-red-500/30 text-red-400 text-[9px]">✕</button>
                        </>
                      )}
                      {selected.status==='draft'&&(profile?.role==='feeder_incharge'||isAdmin())&&(
                        <button onClick={()=>removeItem(item)}
                          className="w-6 h-6 rounded-lg border border-red-500/30 text-red-400 text-[9px]">🗑</button>
                      )}
                    </div>
                  </div>
                  {item.je_note&&<div className="mt-1 text-[10px] text-blue-400">JE: {item.je_note}</div>}
                  {item.removed_by_je&&<div className="mt-1 text-[10px] text-red-400">Removed by JE</div>}
                </div>
              ))}
              {activeItems.length===0&&<div className="text-center py-4 text-mu text-xs">No assets tagged yet</div>}
            </div>
          </div>

          {/* Stage remarks */}
          {myTurn && selected.status !== 'approved' && (
            <div className="bg-sf border border-a/30 rounded-2xl p-4">
              <div className="font-rajdhani font-bold text-xs text-a mb-2">YOUR ACTION</div>
              <textarea className={inp+' mb-3'} rows={2}
                placeholder={`${cfg?.nextLabel} remarks…`}
                value={stageRemarks} onChange={e=>setStageRemarks(e.target.value)} />
              <div className="flex gap-2">
                {cfg?.next && (
                  <button onClick={advanceStage} disabled={saving}
                    className="flex-1 py-3 rounded-xl bg-gradient-to-r from-a to-blue-500 text-bg font-rajdhani font-bold text-sm disabled:opacity-50">
                    {saving?'⏳…':'➡ '+cfg.nextLabel}
                  </button>
                )}
                {selected.status==='se_review'&&['se','admin'].includes(profile?.role)&&(
                  <button onClick={holdProposal} disabled={saving}
                    className="px-3 py-3 rounded-xl border border-amber-500/40 text-amber-400 font-bold text-xs">
                    📦 Hold
                  </button>
                )}
                {rejectCfg && (
                  <button onClick={()=>setShowReject(true)}
                    className="px-3 py-3 rounded-xl border border-amber-500/40 text-amber-400 font-bold text-xs">
                    ↩ {rejectCfg.label}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* AO action */}
          {myTurnAO && (
            <div className="bg-blue-500/10 border border-blue-500/30 rounded-2xl p-4">
              <div className="font-rajdhani font-bold text-xs text-blue-400 mb-2">AO BUDGET REVIEW</div>
              <div className="text-[10px] text-mu mb-3">Add provisional budget note. This does NOT stop the proposal — SE makes final call.</div>
              <button onClick={()=>setShowAO(true)}
                className="w-full py-2.5 rounded-xl bg-blue-500/20 border border-blue-500/40 text-blue-400 font-bold text-sm">
                💰 Add Budget Note
              </button>
            </div>
          )}

          {/* PDF button */}
          {['se_review','approved'].includes(selected.status) && (
            <button onClick={()=>generatePDF(selected)}
              className="w-full py-3 rounded-2xl border border-a/30 bg-a/10 text-a font-rajdhani font-bold">
              📄 Download PDF
            </button>
          )}
        </div>

        {/* Add item modal */}
        {itemForm && (
          <div className="fixed inset-0 z-50 bg-black/70 flex items-end" onClick={()=>setItemForm(null)}>
            <div className="w-full bg-sf border-t border-bd rounded-t-2xl p-4 max-h-[80vh] overflow-y-auto" onClick={e=>e.stopPropagation()}>
              <div className="w-10 h-1 bg-bd rounded-full mx-auto mb-4"/>
              <div className="font-rajdhani font-bold text-a mb-3">Tag Asset for Maintenance</div>
              <div className="space-y-3">
                <div>
                  <label className="text-[10px] text-mu block mb-1">Asset</label>
                  <select className={inp} value={itemForm.assetId}
                    onChange={e=>{
                      const a=assets.find(x=>x.id===e.target.value)
                      setItemForm({...itemForm,assetId:e.target.value,assetType:a?.asset_type||'',issueType:''})
                    }}>
                    <option value="">Select asset…</option>
                    {feederAssets.map(a=><option key={a.id} value={a.id}>{ASSET_TYPES[a.asset_type]?.icon} {a.name} ({ASSET_TYPES[a.asset_type]?.label})</option>)}
                  </select>
                </div>
                {itemForm.assetId && (
                  <div>
                    <label className="text-[10px] text-mu block mb-1">Issue Type</label>
                    <select className={inp} value={itemForm.issueType} onChange={e=>setItemForm({...itemForm,issueType:e.target.value})}>
                      <option value="">Select issue…</option>
                      {issueOptions.map(o=><option key={o}>{o}</option>)}
                    </select>
                  </div>
                )}
                <div>
                  <label className="text-[10px] text-mu block mb-1">Severity</label>
                  <div className="grid grid-cols-4 gap-2">
                    {['low','medium','high','critical'].map(s=>(
                      <button key={s} onClick={()=>setItemForm({...itemForm,severity:s})}
                        className="py-2 rounded-xl border text-[10px] font-bold transition-all"
                        style={itemForm.severity===s?{borderColor:SEV_COLOR[s],background:SEV_COLOR[s]+'22',color:SEV_COLOR[s]}:{borderColor:'#1c3550',color:'#4e7090'}}>
                        {s.charAt(0).toUpperCase()+s.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-[10px] text-mu block mb-1">Description</label>
                  <textarea className={inp} rows={2} value={itemForm.description}
                    onChange={e=>setItemForm({...itemForm,description:e.target.value})}
                    placeholder="Describe the issue in detail…"/>
                </div>
                <div className="flex gap-3">
                  <button onClick={()=>setItemForm(null)} className="px-5 py-3 rounded-xl border border-bd text-mu font-bold">Cancel</button>
                  <button onClick={addItem} disabled={saving}
                    className="flex-1 py-3 rounded-xl bg-gradient-to-r from-a to-blue-500 text-bg font-rajdhani font-bold disabled:opacity-40">
                    {saving?'⏳…':'✅ Tag Asset'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Reject modal */}
        {showReject && (
          <div className="fixed inset-0 z-50 bg-black/70 flex items-end" onClick={()=>setShowReject(false)}>
            <div className="w-full bg-sf border-t border-amber-500/40 rounded-t-2xl p-4" onClick={e=>e.stopPropagation()}>
              <div className="font-rajdhani font-bold text-amber-400 mb-3">↩ {REJECT_TO[selected.status]?.label}</div>
              <textarea className={inp+' mb-3'} rows={3}
                placeholder="Reason for sending back (required)…"
                value={rejectReason} onChange={e=>setRejectReason(e.target.value)}/>
              <div className="flex gap-3">
                <button onClick={()=>setShowReject(false)} className="px-5 py-3 rounded-xl border border-bd text-mu font-bold">Cancel</button>
                <button onClick={rejectStage} disabled={saving}
                  className="flex-1 py-3 rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-400 font-rajdhani font-bold disabled:opacity-50">
                  {saving?'⏳…':'↩ Send Back'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* AO Modal */}
        {showAO && (
          <div className="fixed inset-0 z-50 bg-black/70 flex items-end" onClick={()=>setShowAO(false)}>
            <div className="w-full bg-sf border-t border-blue-500/40 rounded-t-2xl p-4" onClick={e=>e.stopPropagation()}>
              <div className="font-rajdhani font-bold text-blue-400 mb-3">💰 AO Budget Note</div>
              <div className="text-[10px] text-mu mb-3 bg-blue-500/10 rounded-xl p-3">
                This is a provisional note only. Final budget sanction is a separate procedure. 
                Your refusal does NOT drop the proposal — SE makes the final call.
              </div>
              <div className="grid grid-cols-2 gap-3 mb-3">
                {[['provisionally_approved','✅ Provisionally Approved'],['refused','⚠️ Budget Not Available']].map(([val,label])=>(
                  <button key={val} onClick={()=>setAOBudgetStatus(val)}
                    className={`py-3 rounded-xl border text-xs font-bold transition-all ${aoBudgetStatus===val
                      ?val==='provisionally_approved'?'border-green-500 bg-green-500/15 text-green-400':'border-amber-500 bg-amber-500/15 text-amber-400'
                      :'border-bd text-mu'}`}>
                    {label}
                  </button>
                ))}
              </div>
              <textarea className={inp+' mb-3'} rows={2}
                placeholder="Budget note / remarks…"
                value={aoBudgetNote} onChange={e=>setAOBudgetNote(e.target.value)}/>
              <div className="flex gap-3">
                <button onClick={()=>setShowAO(false)} className="px-5 py-3 rounded-xl border border-bd text-mu font-bold">Cancel</button>
                <button onClick={aoReview} disabled={saving}
                  className="flex-1 py-3 rounded-xl bg-blue-500/20 border border-blue-500/40 text-blue-400 font-rajdhani font-bold disabled:opacity-50">
                  {saving?'⏳…':'💰 Submit Note'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }
  return null
}
