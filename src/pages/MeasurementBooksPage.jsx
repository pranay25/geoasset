import { useEffect, useState } from 'react'
import { useMBStore, useWOStore, useFeederStore, useAssetStore, useAuthStore, useUIStore } from '../store/index.js'
import { mbApi } from '../api/client.js'
import { STATUS_COLORS } from '../utils/constants.js'

function generateMBPDF(mb, org) {
  import('jspdf').then((mod) => {
    try {
    const jsPDF = mod.jsPDF || mod.default?.jsPDF || mod.default
    const doc = new jsPDF({ orientation:'portrait', unit:'mm', format:'a4' })
    const W = 210, M = 15
    // Header
    doc.setFillColor(7,16,30); doc.rect(0,0,W,40,'F')
    doc.setTextColor(0,212,255); doc.setFontSize(16); doc.setFont('helvetica','bold')
    doc.text('JVVNL / '+org?.name, W/2, 14, {align:'center'})
    doc.setFontSize(10); doc.setTextColor(180,200,220)
    doc.text(org?.division+' · '+org?.city+', '+org?.state, W/2, 21, {align:'center'})
    doc.setFontSize(14); doc.setTextColor(255,255,255)
    doc.text('MEASUREMENT BOOK', W/2, 32, {align:'center'})
    // Meta
    let y=50
    doc.setTextColor(50,50,50); doc.setFontSize(9)
    const meta=[['MB Number',mb.mb_number],['WO Number',mb.work_orders?.wo_number||'–'],['Date',mb.mb_date],
      ['Feeder',mb.feeders?.code||'–'],['Contractor',mb.contractor_name||'–'],['Status',mb.status.toUpperCase()]]
    meta.forEach(([k,v],i)=>{
      const x=i%2===0?M:W/2
      if(i%2===0) y+=7
      doc.setFont('helvetica','bold'); doc.text(k+':', x, y)
      doc.setFont('helvetica','normal'); doc.text(String(v), x+35, y)
    })
    // Table
    y+=12
    doc.setFillColor(7,16,30); doc.rect(M,y-5,W-2*M,8,'F')
    doc.setTextColor(0,212,255); doc.setFontSize(8); doc.setFont('helvetica','bold')
    const cols=['#','Description','Unit','Qty','Rate(₹)','Amount(₹)']
    const cw=[8,70,15,12,20,20]; let cx=M
    cols.forEach((c,i)=>{ doc.text(c,cx+1,y); cx+=cw[i] }); y+=3
    doc.setTextColor(30,30,30); doc.setFont('helvetica','normal')
    ;(mb.items||[]).forEach((it,i)=>{
      y+=7; if(y>270){doc.addPage();y=20}
      const row=[String(i+1),it.description||'',it.unit||'',String(it.qty||''),String(it.rate||''),String(it.amount||'')]
      cx=M; row.forEach((v,j)=>{ doc.text(String(v).slice(0,j===1?40:12),cx+1,y); cx+=cw[j] })
    })
    // Total
    y+=7; doc.setFillColor(240,248,255); doc.rect(M,y-4,W-2*M,7,'F')
    doc.setFont('helvetica','bold')
    doc.text(`TOTAL: Rs. ${(mb.total_amount||0).toLocaleString('en-IN')}`, W-M, y, {align:'right'})
    // Signatures
    y+=20; doc.setFont('helvetica','normal'); doc.setFontSize(8)
    ;['Prepared By','Checked By','Approved By'].forEach((s,i)=>{
      const sx=M+(i*(W-2*M)/3)
      doc.line(sx,y,sx+50,y)
      doc.text(s,sx+25,y+4,{align:'center'})
    })
    // Footer
    doc.setFontSize(7); doc.setTextColor(150,150,150)
    doc.text(`GeoAsset · ${mb.mb_number} · ${new Date().toLocaleDateString('en-IN')}`, W/2, 285, {align:'center'})
    doc.save(`${mb.mb_number}_MB.pdf`)
    } catch(e) { console.error('PDF error:', e) }
  })
}

export default function MeasurementBooksPage() {
  const { mbs, fetch, add, update } = useMBStore()
  const { wos } = useWOStore()
  const { assets } = useAssetStore()
  const { feeders } = useFeederStore()
  const { profile, org, canApprove } = useAuthStore()
  const { toast } = useUIStore()

  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ title:'', wo_id:'', contractor_name:'', feeder_id:'', items:[] })
  const [newItem, setNewItem] = useState({ description:'', unit:'No.', qty:1, rate:0, amount:0 })

  useEffect(() => { fetch() }, [])

  function calcItem(i) {
    const amt = (parseFloat(i.qty)||0)*(parseFloat(i.rate)||0)
    return { ...i, amount: +amt.toFixed(2) }
  }

  function addItem() {
    const item = calcItem({ ...newItem, id: Date.now() })
    setForm(f=>({ ...f, items:[...f.items,item] }))
    setNewItem({ description:'', unit:'No.', qty:1, rate:0, amount:0 })
  }

  function removeItem(id) { setForm(f=>({ ...f, items:f.items.filter(i=>i.id!==id) })) }

  async function createFromWO(wo) {
    const woAssets = (wo.asset_ids||[]).map(id=>assets.find(a=>a.id===id)).filter(Boolean)
    const items = woAssets.map((a,i)=>({
      id:i+1, description:`${wo.issue_type||'Work'} — ${a.name}`,
      unit:'No.', qty:1, rate:0, amount:0,
      latitude:a.latitude, longitude:a.longitude,
    }))
    setForm({ title:wo.title, wo_id:wo.id, contractor_name:'', feeder_id:wo.feeder_id||'', items })
    setShowForm(true)
  }

  async function submit() {
    if (!form.title) return toast('Title required','err')
    setSaving(true)
    try {
      const mb = await mbApi.create({ ...form, wo_id:form.wo_id||null, feeder_id:form.feeder_id||null, prepared_by_id:profile?.id })
      add(mb)
      toast(`✅ ${mb.mb_number} created`,'ok')
      setShowForm(false)
      setForm({ title:'', wo_id:'', contractor_name:'', feeder_id:'', items:[] })
    } catch(e){ toast(e.message,'err') } finally { setSaving(false) }
  }

  async function changeStatus(mb, status) {
    const updated = await mbApi.updateStatus(mb.id, status, profile?.id)
    update(mb.id, updated)
    toast(status==='submitted'?'✅ Submitted':status==='approved'?'✅ Approved':'❌ Rejected', status==='rejected'?'warn':'ok')
  }

  const inp = "w-full bg-bg border border-bd rounded-xl px-3 py-2 text-sm text-tx focus:outline-none focus:border-a"

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 pb-2 flex-shrink-0 flex items-center justify-between">
        <div className="font-rajdhani font-bold text-sm">Measurement Books</div>
        <button onClick={()=>setShowForm(true)} className="px-3 py-2 rounded-xl bg-a/10 border border-a/30 text-a text-xs font-bold">+ New MB</button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-3">
        {mbs.map(mb=>(
          <div key={mb.id} className="bg-sf border border-bd rounded-2xl p-4 mb-3">
            <div className="flex items-start justify-between mb-2">
              <div>
                <div className="font-mono text-[11px] text-mu">{mb.mb_number}</div>
                <div className="font-semibold text-sm mt-0.5">{mb.title}</div>
                <div className="text-[10px] text-mu mt-1 flex gap-2">
                  {mb.mb_date&&<span>📅 {mb.mb_date}</span>}
                  {mb.contractor_name&&<span>🏗️ {mb.contractor_name}</span>}
                  {mb.total_amount>0&&<span className="font-mono text-amber-400">₹{mb.total_amount.toLocaleString('en-IN')}</span>}
                </div>
              </div>
              <span className="text-[9px] font-bold px-2 py-1 rounded-full"
                style={{background:STATUS_COLORS[mb.status]+'22',color:STATUS_COLORS[mb.status]}}>
                {mb.status?.toUpperCase()}
              </span>
            </div>
            <div className="flex gap-2 flex-wrap">
              <button onClick={()=>generateMBPDF(mb,org)}
                className="px-3 py-2 rounded-xl border border-bd bg-sf2 text-xs font-bold text-mu">📄 PDF</button>
              {mb.status==='draft'&&(
                <button onClick={()=>changeStatus(mb,'submitted')}
                  className="px-3 py-2 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-400 text-xs font-bold">✅ Submit</button>
              )}
              {mb.status==='submitted'&&canApprove()&&(
                <>
                  <button onClick={()=>changeStatus(mb,'approved')}
                    className="px-3 py-2 rounded-xl border border-green-500/30 bg-green-500/10 text-green-400 text-xs font-bold">✓ Approve</button>
                  <button onClick={()=>changeStatus(mb,'rejected')}
                    className="px-3 py-2 rounded-xl border border-red-500/30 bg-red-500/10 text-red-400 text-xs font-bold">✗ Reject</button>
                </>
              )}
            </div>
          </div>
        ))}

        {/* Quick create from WO */}
        {wos.filter(w=>w.status!=='closed').length>0&&(
          <div className="mt-2">
            <div className="text-[10px] text-mu mb-2">Quick MB from open WO:</div>
            {wos.filter(w=>w.status!=='closed').slice(0,3).map(wo=>(
              <button key={wo.id} onClick={()=>createFromWO(wo)}
                className="w-full text-left text-xs p-2.5 mb-1 rounded-xl border border-bd bg-sf hover:border-a/50 transition-colors">
                <span className="font-mono text-mu mr-2">{wo.wo_number}</span>{wo.title}
              </button>
            ))}
          </div>
        )}
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-end" onClick={()=>setShowForm(false)}>
          <div className="w-full bg-sf border-t border-bd rounded-t-2xl p-4 max-h-[92vh] overflow-y-auto" onClick={e=>e.stopPropagation()}>
            <div className="w-10 h-1 bg-bd rounded-full mx-auto mb-4" />
            <div className="font-rajdhani font-bold text-a mb-4">📋 New Measurement Book</div>
            <div className="space-y-3">
              <div><label className="text-[10px] text-mu block mb-1">Title *</label>
                <input className={inp} value={form.title} onChange={e=>setForm({...form,title:e.target.value})} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-[10px] text-mu block mb-1">Linked WO</label>
                  <select className={inp} value={form.wo_id} onChange={e=>setForm({...form,wo_id:e.target.value})}>
                    <option value="">None</option>
                    {wos.map(w=><option key={w.id} value={w.id}>{w.wo_number}</option>)}
                  </select>
                </div>
                <div><label className="text-[10px] text-mu block mb-1">Feeder</label>
                  <select className={inp} value={form.feeder_id} onChange={e=>setForm({...form,feeder_id:e.target.value})}>
                    <option value="">Select…</option>
                    {feeders.map(f=><option key={f.id} value={f.id}>{f.code} {f.name}</option>)}
                  </select>
                </div>
              </div>
              <div><label className="text-[10px] text-mu block mb-1">Contractor</label>
                <input className={inp} value={form.contractor_name} onChange={e=>setForm({...form,contractor_name:e.target.value})} /></div>

              {/* Items */}
              <div>
                <div className="text-[10px] text-mu mb-2">Measurement Items ({form.items.length})</div>
                {form.items.map(it=>(
                  <div key={it.id} className="flex items-center gap-2 py-1.5 border-b border-bd/50 text-[10px]">
                    <div className="flex-1 min-w-0"><div className="truncate">{it.description}</div>
                      <div className="text-mu">{it.unit} × {it.qty} × ₹{it.rate} = ₹{it.amount}</div></div>
                    <button onClick={()=>removeItem(it.id)} className="text-red-400 text-xs">✕</button>
                  </div>
                ))}
                <div className="bg-bg rounded-xl p-3 mt-2 space-y-2">
                  <input className={inp+' text-xs'} placeholder="Description" value={newItem.description}
                    onChange={e=>setNewItem({...newItem,description:e.target.value})} />
                  <div className="grid grid-cols-3 gap-2">
                    <select className={inp+' text-xs'} value={newItem.unit} onChange={e=>setNewItem({...newItem,unit:e.target.value})}>
                      {['No.','Mtr','Set','LS','Point','Kg'].map(u=><option key={u}>{u}</option>)}
                    </select>
                    <input type="number" className={inp+' text-xs'} placeholder="Qty" value={newItem.qty}
                      onChange={e=>setNewItem(i=>calcItem({...i,qty:e.target.value}))} />
                    <input type="number" className={inp+' text-xs'} placeholder="Rate ₹" value={newItem.rate}
                      onChange={e=>setNewItem(i=>calcItem({...i,rate:e.target.value}))} />
                  </div>
                  {newItem.amount>0&&<div className="text-[10px] text-a font-mono">Amount: ₹{newItem.amount}</div>}
                  <button onClick={addItem} className="w-full py-2 rounded-lg border border-a/30 text-a text-xs font-bold">+ Add Item</button>
                </div>
                {form.items.length>0&&(
                  <div className="text-right text-sm font-bold text-amber-400 mt-2">
                    Total: ₹{form.items.reduce((s,i)=>s+(parseFloat(i.amount)||0),0).toLocaleString('en-IN')}
                  </div>
                )}
              </div>

              <div className="flex gap-3 pt-1">
                <button onClick={submit} disabled={saving} className="flex-1 py-3 rounded-xl bg-gradient-to-r from-a to-blue-500 text-bg font-rajdhani font-bold disabled:opacity-50">
                  {saving?'⏳…':'📋 Create MB'}
                </button>
                <button onClick={()=>setShowForm(false)} className="px-6 py-3 rounded-xl border border-bd text-mu font-bold">Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
