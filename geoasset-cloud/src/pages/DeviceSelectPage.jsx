import { useNavigate } from 'react-router-dom'

export default function DeviceSelectPage() {
  const navigate = useNavigate()

  function choose(mode) {
    localStorage.setItem('geoasset_ui_mode', mode)
    navigate('/', { replace: true })
  }

  return (
    <div className="min-h-screen bg-bg flex flex-col items-center justify-center p-6">
      {/* Logo */}
      <div className="text-center mb-12">
        <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-a via-blue-500 to-blue-700 flex items-center justify-center text-5xl mx-auto mb-5 shadow-2xl shadow-a/20">⚡</div>
        <div className="font-rajdhani text-a text-4xl font-bold tracking-widest">GeoAsset</div>
        <div className="text-mu text-sm tracking-widest uppercase mt-2">Field Asset Management</div>
      </div>

      <div className="text-tx text-center mb-8">
        <div className="text-lg font-semibold">How are you using GeoAsset?</div>
        <div className="text-mu text-sm mt-1">We'll remember your choice on this device</div>
      </div>

      <div className="w-full max-w-sm space-y-4">
        {/* Mobile option */}
        <button onClick={() => choose('mobile')}
          className="w-full bg-sf border-2 border-bd hover:border-a rounded-2xl p-6 text-left transition-all group">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-a/10 border border-a/30 flex items-center justify-center text-3xl flex-shrink-0 group-hover:bg-a/20 transition-colors">
              📱
            </div>
            <div>
              <div className="font-rajdhani font-bold text-lg text-tx group-hover:text-a transition-colors">Mobile / Field</div>
              <div className="text-mu text-sm mt-0.5">GPS survey, asset mapping,</div>
              <div className="text-mu text-sm">work orders in the field</div>
              <div className="mt-2 flex gap-1 flex-wrap">
                {['GPS Survey','Map View','My WOs','Quick Flag'].map(t=>(
                  <span key={t} className="text-[9px] px-2 py-0.5 rounded-full bg-a/10 text-a border border-a/20">{t}</span>
                ))}
              </div>
            </div>
          </div>
        </button>

        {/* Desktop option */}
        <button onClick={() => choose('desktop')}
          className="w-full bg-sf border-2 border-bd hover:border-a2 rounded-2xl p-6 text-left transition-all group">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-a2/10 border border-a2/30 flex items-center justify-center text-3xl flex-shrink-0 group-hover:bg-a2/20 transition-colors">
              🖥️
            </div>
            <div>
              <div className="font-rajdhani font-bold text-lg text-tx group-hover:text-a2 transition-colors">Desktop / Office</div>
              <div className="text-mu text-sm mt-0.5">Full dashboard, reports,</div>
              <div className="text-mu text-sm">user management, MBs</div>
              <div className="mt-2 flex gap-1 flex-wrap">
                {['All Features','Reports','Users','Recovery','MBs'].map(t=>(
                  <span key={t} className="text-[9px] px-2 py-0.5 rounded-full bg-a2/10 text-a2 border border-a2/20">{t}</span>
                ))}
              </div>
            </div>
          </div>
        </button>
      </div>

      <div className="mt-8 text-[11px] text-mu text-center">
        You can change this anytime from the settings menu
      </div>
    </div>
  )
}
