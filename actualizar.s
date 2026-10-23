#!/bin/bash
echo "🚀 Actualizando AviaTrack para que sea IDÉNTICO al HTML original..."

cd ~/Documentos/easa-part66-app || { echo "❌ Error: Carpeta no encontrada."; exit 1; }

echo "📝 Actualizando TLBList.jsx (Lógica exacta del HTML)..."
cat > src/components/TLBList.jsx << 'EOF'
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'

function formatDate(dateString) {
  if (!dateString) return '-'
  const [y, m, d] = dateString.split('-')
  return `${d}/${m}/${y}`
}

export default function TLBList() {
  const [tlbs, setTlbs] = useState([])
  const [defects, setDefects] = useState([])
  const [practices, setPractices] = useState([])
  const [modules, setModules] = useState([])
  const [selectedTLB, setSelectedTLB] = useState(null)
  const [loading, setLoading] = useState(true)
  
  // Filtros idénticos al HTML
  const [filterModule, setFilterModule] = useState('')
  const [filterPractice, setFilterPractice] = useState('')
  const [filterDate, setFilterDate] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  
  // Simulación de rol (como en el HTML: admin/profesor ven todo, alumno solo publicados)
  const [userRole, setUserRole] = useState('profesor') // Cambiar a 'alumno' para probar

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setLoading(true)
    const { data: tlbsData } = await supabase.from('tlbs').select('*').order('date', { ascending: false })
    const { data: practicesData } = await supabase.from('practices').select('id, title, module_id, ata')
    const { data: defectsData } = await supabase.from('defects').select('*').order('defect_number', { ascending: true })
    const { data: modulesData } = await supabase.from('modules').select('id, name')

    setTlbs(tlbsData || [])
    setPractices(practicesData || [])
    setDefects(defectsData || [])
    setModules(modulesData || [])
    setLoading(false)
  }

  function getPractice(id) { return practices.find(p => p.id === id) }
  function getModule(id) { return modules.find(m => m.id === id) }
  function getDefectsByTLB(tlbId) { return defects.filter(d => d.tlb_id === tlbId) }

  // Lógica de filtrado idéntica al HTML
  const filteredTLBs = tlbs.filter(t => {
    // Si es alumno, solo ve publicados (como en el HTML)
    if (userRole === 'alumno' && !t.published) return false
    
    const p = getPractice(t.practice_id)
    const matchModule = !filterModule || t.module_id === filterModule
    const matchPractice = !filterPractice || t.practice_id === filterPractice
    const matchDate = !filterDate || t.date === filterDate
    
    let matchSearch = true
    if (searchTerm) {
      const searchLower = searchTerm.toLowerCase()
      matchSearch = (p?.title?.toLowerCase().includes(searchLower) || 
                     t.practice_id?.toLowerCase().includes(searchLower) ||
                     t.aircraft?.toLowerCase().includes(searchLower))
    }
    return matchModule && matchPractice && matchDate && matchSearch
  })

  // Funciones de acción (como en el HTML)
  async function togglePublish(tlbId, currentStatus) {
    const { error } = await supabase.from('tlbs').update({ published: !currentStatus }).eq('id', tlbId)
    if (!error) setTlbs(tlbs.map(t => t.id === tlbId ? { ...t, published: !currentStatus } : t))
  }

  async function addDefect() {
    if (!selectedTLB) return
    const currentDefects = getDefectsByTLB(selectedTLB.id)
    const newDefect = { 
      tlb_id: selectedTLB.id, 
      defect_number: currentDefects.length + 1, 
      ata: 'ATA 00', 
      pirep: 'CPT', 
      defect_description: 'NUEVO DEFECTO - Editar', 
      correct_action: 'ACCIÓN CORRECTIVA - Editar' 
    }
    const { data, error } = await supabase.from('defects').insert([newDefect]).select().single()
    if (!error) setDefects([...defects, data])
  }

  async function editDefect(defect) {
    const newDesc = prompt('Editar Descripción del Defecto:', defect.defect_description)
    if (newDesc === null) return
    const newAction = prompt('Editar Acción Correctiva:', defect.correct_action)
    if (newAction === null) return
    
    const { error } = await supabase.from('defects').update({ 
      defect_description: newDesc, correct_action: newAction 
    }).eq('id', defect.id)
    
    if (!error) {
      setDefects(defects.map(d => d.id === defect.id ? { ...d, defect_description: newDesc, correct_action: newAction } : d))
    }
  }

  if (loading) return <div className="min-h-screen bg-[#f4f6f9] flex items-center justify-center"><p className="text-[#0a2540] text-xl font-semibold">Cargando Task Log Book...</p></div>

  // ==================== VISTA DETALLE (Idéntica al HTML) ====================
  if (selectedTLB) {
    const practice = getPractice(selectedTLB.practice_id)
    const module = getModule(selectedTLB.module_id)
    const tlbDefects = getDefectsByTLB(selectedTLB.id)
    const isBlocked = userRole === 'alumno' && !selectedTLB.published

    if (isBlocked) {
      return (
        <div className="min-h-screen bg-[#f4f6f9] p-8">
          <button onClick={() => setSelectedTLB(null)} className="mb-6 px-4 py-2 bg-white border border-[#e5e7eb] text-[#0a2540] rounded-lg hover:bg-gray-50">← Volver a TLB</button>
          <div className="bg-gradient-to-r from-[#0a2540] to-[#1e88e5] text-white rounded-lg p-6 mb-6 opacity-70">
            <h2 className="text-2xl font-bold mb-2">✈️ {selectedTLB.aircraft}</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-white/15 p-3 rounded"><div className="text-xs opacity-80 uppercase">Matrícula</div><div className="font-semibold">{selectedTLB.registration}</div></div>
              <div className="bg-white/15 p-3 rounded"><div className="text-xs opacity-80 uppercase">MSN</div><div className="font-semibold">{selectedTLB.msn}</div></div>
              <div className="bg-white/15 p-3 rounded"><div className="text-xs opacity-80 uppercase">Módulo</div><div className="font-semibold">{module?.id || '-'}</div></div>
              <div className="bg-white/15 p-3 rounded"><div className="text-xs opacity-80 uppercase">Práctica</div><div className="font-semibold">{practice?.id || '-'}</div></div>
            </div>
          </div>
          <div className="bg-[#fff8e1] border-2 border-[#ef6c00] rounded-lg p-10 text-center">
            <div className="text-6xl mb-4 opacity-70">🔒</div>
            <h3 className="text-[#ef6c00] text-xl font-bold mb-3">TLB bloqueado pendiente de publicación</h3>
            <p className="text-[#6b7280] max-w-lg mx-auto">Este Task Log Book aún no ha sido publicado por el profesor. Los defectos y acciones correctivas no están disponibles hasta que el profesor lo publique oficialmente.</p>
          </div>
        </div>
      )
    }

    return (
      <div className="min-h-screen bg-[#f4f6f9] p-8">
        <button onClick={() => setSelectedTLB(null)} className="mb-6 px-4 py-2 bg-white border border-[#e5e7eb] text-[#0a2540] rounded-lg hover:bg-gray-50 flex items-center gap-2">← Volver a TLB</button>
        
        <div className="bg-gradient-to-r from-[#0a2540] to-[#1e88e5] text-white rounded-lg p-6 mb-6 shadow-lg">
          <h2 className="text-2xl font-bold mb-4">✈️ {selectedTLB.aircraft}</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white/15 p-3 rounded"><div className="text-xs opacity-80 uppercase">Matrícula</div><div className="font-semibold">{selectedTLB.registration}</div></div>
            <div className="bg-white/15 p-3 rounded"><div className="text-xs opacity-80 uppercase">MSN</div><div className="font-semibold">{selectedTLB.msn}</div></div>
            <div className="bg-white/15 p-3 rounded"><div className="text-xs opacity-80 uppercase">Módulo</div><div className="font-semibold">{module?.id || '-'}</div></div>
            <div className="bg-white/15 p-3 rounded"><div className="text-xs opacity-80 uppercase">Práctica</div><div className="font-semibold">{practice?.id || '-'}</div></div>
            <div className="bg-white/15 p-3 rounded"><div className="text-xs opacity-80 uppercase">Fecha</div><div className="font-semibold">{formatDate(selectedTLB.date)}</div></div>
            <div className="bg-white/15 p-3 rounded"><div className="text-xs opacity-80 uppercase">Profesor</div><div className="font-semibold">{selectedTLB.teacher_name || 'No asignado'}</div></div>
            <div className="bg-white/15 p-3 rounded"><div className="text-xs opacity-80 uppercase">Estado</div><div className="font-semibold">{selectedTLB.published ? '✅ Publicado' : '⏳ Pendiente'}</div></div>
          </div>
        </div>

        <div className="bg-white rounded-lg p-5 shadow-sm mb-6 border border-[#e5e7eb]">
          <div className="flex justify-between items-center flex-wrap gap-4">
            <h3 className="text-lg font-bold text-[#0a2540]">📝 Defectos ({tlbDefects.length})</h3>
            <div className="flex gap-2">
              {userRole !== 'alumno' && (
                <>
                  <button onClick={() => togglePublish(selectedTLB.id, selectedTLB.published)} className={`px-4 py-2 rounded-lg font-semibold text-sm border-2 transition-all ${selectedTLB.published ? 'bg-[#d4edda] text-[#155724] border-[#c3e6cb] hover:opacity-85' : 'bg-[#f8d7da] text-[#721c24] border-[#f5c6cb] hover:opacity-85'}`}>
                    {selectedTLB.published ? '✅ Publicado - Click para despublicar' : '⏳ Pendiente - Click para publicar'}
                  </button>
                  <button onClick={addDefect} className="px-4 py-2 bg-[#1e88e5] text-white rounded-lg font-semibold text-sm hover:bg-[#1565c0]">+ Añadir Defecto</button>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          {tlbDefects.length === 0 ? (
            <div className="bg-white rounded-lg p-10 text-center text-[#6b7280]">
              <div className="text-4xl mb-3 opacity-50">📝</div>
              <p>No hay defectos registrados en este TLB</p>
            </div>
          ) : (
            tlbDefects.map((defect) => (
              <div key={defect.id} className="bg-white rounded-lg p-5 shadow-sm border-l-4 border-[#ef6c00] relative">
                {userRole !== 'alumno' && (
                  <button onClick={() => editDefect(defect)} className="absolute top-4 right-4 px-3 py-1 bg-gray-100 hover:bg-gray-200 rounded text-sm">✏️ Editar</button>
                )}
                <div className="flex justify-between items-start mb-3 flex-wrap gap-2 pr-20">
                  <div className="text-base font-bold text-[#0a2540]">DEFECT #{defect.defect_number}</div>
                  <div className="flex gap-2">
                    <span className="px-2 py-1 text-xs font-semibold rounded bg-[#d1ecf1] text-[#0c5460]">{defect.ata}</span>
                    {defect.pirep && <span className="px-2 py-1 text-xs font-semibold rounded bg-[#1e88e5] text-white">PIREP: {defect.pirep}</span>}
                  </div>
                </div>
                <div className="mb-4">
                  <div className="text-xs font-semibold text-[#6b7280] uppercase tracking-wide mb-2">⚠️ Descripción del Defecto</div>
                  <div className="text-sm text-[#1a1a1a] leading-relaxed p-3 bg-[#fff8e1] rounded border-l-4 border-[#ef6c00]">{defect.defect_description}</div>
                </div>
                <div>
                  <div className="text-xs font-semibold text-[#6b7280] uppercase tracking-wide mb-2">✅ Acción Correctiva</div>
                  <div className="text-sm text-[#1a1a1a] leading-relaxed p-3 bg-[#e8f5e9] rounded border-l-4 border-[#2e7d32]">{defect.correct_action}</div>
                </div>
              </div>
            ))
          )}
        </div>

        {selectedTLB.crs && (
          <div className="bg-[#e8f5e9] rounded-lg p-5 mt-6 border-l-4 border-[#2e7d32] shadow-sm">
            <h4 className="text-[#2e7d32] font-semibold mb-2 text-sm">✅ CRS - Certificate of Release to Service</h4>
            <p className="text-sm text-[#1a1a1a] leading-relaxed">{selectedTLB.crs}</p>
          </div>
        )}
      </div>
    )
  }

  // ==================== VISTA LISTA (Idéntica al HTML) ====================
  const availableModules = [...new Set(tlbs.map(t => t.module_id))]
  const availablePractices = [...new Set(tlbs.map(t => t.practice_id))]
  const availableDates = [...new Set(tlbs.map(t => t.date))].sort().reverse()

  return (
    <div className="min-h-screen bg-[#f4f6f9] p-8">
      <div className="bg-white rounded-lg p-5 shadow-sm border border-[#e5e7eb] mb-6">
        <div className="flex justify-between items-center mb-4 flex-wrap gap-4">
          <h3 className="text-lg font-bold text-[#0a2540]">📋 Task Log Book ({filteredTLBs.length})</h3>
          <div className="flex items-center gap-3 bg-gray-50 p-2 rounded-lg border border-gray-200">
            <span className={`text-sm font-semibold ${userRole === 'profesor' ? 'text-[#1e88e5]' : 'text-gray-500'}`}>👨‍🏫 Profesor</span>
            <button onClick={() => setUserRole(userRole === 'profesor' ? 'alumno' : 'profesor')} className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${userRole === 'profesor' ? 'bg-[#1e88e5]' : 'bg-gray-300'}`}>
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${userRole === 'profesor' ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
            <span className={`text-sm font-semibold ${userRole === 'alumno' ? 'text-[#1e88e5]' : 'text-gray-500'}`}>👨‍🎓 Alumno</span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-3 mb-4 p-3 bg-[#f0f7ff] rounded-lg">
          <div>
            <label className="block text-xs font-semibold text-[#6b7280] mb-1">📚 Módulo</label>
            <select value={filterModule} onChange={(e) => setFilterModule(e.target.value)} className="w-full px-3 py-2 border border-[#e5e7eb] rounded text-sm focus:outline-none focus:border-[#1e88e5]">
              <option value="">Todos</option>
              {availableModules.map(m => { const mod = getModule(m); return <option key={m} value={m}>{m} {mod ? '- ' + mod.name : ''}</option> })}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#6b7280] mb-1">🔧 Práctica</label>
            <select value={filterPractice} onChange={(e) => setFilterPractice(e.target.value)} className="w-full px-3 py-2 border border-[#e5e7eb] rounded text-sm focus:outline-none focus:border-[#1e88e5]">
              <option value="">Todas</option>
              {availablePractices.map(p => { const prac = getPractice(p); return <option key={p} value={p}>{p} {prac ? '- ' + prac.title : ''}</option> })}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#6b7280] mb-1">📅 Día</label>
            <select value={filterDate} onChange={(e) => setFilterDate(e.target.value)} className="w-full px-3 py-2 border border-[#e5e7eb] rounded text-sm focus:outline-none focus:border-[#1e88e5]">
              <option value="">Todas</option>
              {availableDates.map(d => <option key={d} value={d}>{formatDate(d)}</option>)}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs font-semibold text-[#6b7280] mb-1">🔍 Buscar</label>
            <input type="text" placeholder="Nombre o nº práctica..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full px-3 py-2 border border-[#e5e7eb] rounded text-sm focus:outline-none focus:border-[#1e88e5]" />
          </div>
        </div>

        <p className="text-sm text-[#6b7280] mb-4">
          {userRole === 'alumno' ? '💡 Solo puedes ver los TLBs que han sido publicados por tu profesor.' : '👨‍🏫 Como profesor/admin, debes publicar los TLBs para que los alumnos puedan acceder a ellos.'}
        </p>

        <div className="space-y-3">
          {filteredTLBs.length === 0 ? (
            <div className="bg-white rounded-lg p-10 text-center text-[#6b7280]">
              <div className="text-4xl mb-3 opacity-50">🔍</div>
              <p>No hay TLBs que coincidan con los filtros</p>
            </div>
          ) : (
            filteredTLBs.map((t) => {
              const p = getPractice(t.practice_id)
              const m = getModule(t.module_id)
              const tDefects = getDefectsByTLB(t.id)
              return (
                <div key={t.id} onClick={() => setSelectedTLB(t)} className="bg-white rounded-lg p-4 border border-[#e5e7eb] border-l-4 border-l-[#1e88e5] cursor-pointer hover:border-l-[#ffb300] hover:shadow-md transition-all flex justify-between items-center flex-wrap gap-4">
                  <div className="flex-1 min-w-[200px]">
                    <div className="font-bold text-[#0a2540] text-base mb-1">{p ? p.id + ' - ' + p.title : 'Práctica sin identificar'}</div>
                    <div className="flex flex-wrap gap-3 text-xs text-[#6b7280]">
                      <span>✈️ {t.aircraft} ({t.registration})</span>
                      <span>📚 {m?.id || '-'}</span>
                      <span>📅 {formatDate(t.date)}</span>
                      <span>📝 {tDefects.length} defectos</span>
                      {t.teacher_name && <span>👨‍🏫 {t.teacher_name}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {t.published ? (
                      <span className="px-3 py-1 text-xs font-semibold rounded bg-[#d4edda] text-[#155724]">✅ Publicado</span>
                    ) : (
                      <span className="px-3 py-1 text-xs font-semibold rounded bg-[#fff3cd] text-[#856404]">⏳ Pendiente</span>
                    )}
                    {userRole !== 'alumno' && (
                      <button onClick={(e) => { e.stopPropagation(); togglePublish(t.id, t.published) }} className="p-2 bg-gray-100 hover:bg-gray-200 rounded text-sm" title={t.published ? 'Despublicar' : 'Publicar'}>
                        {t.published ? '🔒' : '📢'}
                      </button>
                    )}
                    <span className="text-xl text-[#6b7280]">→</span>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
EOF

echo "📝 Actualizando PracticeList.jsx..."
cat > src/components/PracticeList.jsx << 'EOF'
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'

function formatDate(dateString) { if (!dateString) return '-'; const [y, m, d] = dateString.split('-'); return `${d}/${m}/${y}` }

export default function PracticeList() {
  const [practices, setPractices] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchPractices() {
      const { data, error } = await supabase.from('practices').select('*').order('date', { ascending: true })
      if (!error) setPractices(data)
      setLoading(false)
    }
    fetchPractices()
  }, [])

  if (loading) return <div className="min-h-screen bg-[#f4f6f9] flex items-center justify-center"><p className="text-[#0a2540] text-xl">Cargando prácticas...</p></div>

  return (
    <div className="min-h-screen bg-[#f4f6f9] p-8">
      <div className="bg-white rounded-lg p-5 shadow-sm border border-[#e5e7eb] mb-6">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-bold text-[#0a2540]">🔧 Prácticas del Módulo ({practices.length})</h3>
        </div>
        <div className="space-y-3">
          {practices.map((p) => (
            <div key={p.id} className="bg-white border border-[#e5e7eb] border-l-4 border-l-[#1e88e5] rounded-lg p-4 cursor-pointer hover:border-l-[#ffb300] hover:shadow-md transition-all">
              <div className="flex justify-between items-start gap-4">
                <div className="flex-1">
                  <div className="flex gap-2 items-center mb-2 flex-wrap">
                    <code className="bg-[#f0f7ff] px-2 py-1 rounded text-xs font-mono text-[#0a2540] font-bold">{p.id}</code>
                    <span className="px-2 py-1 text-xs font-semibold rounded bg-[#d1ecf1] text-[#0c5460]">{p.ata}</span>
                    <span className="px-2 py-1 text-xs font-semibold rounded bg-[#fff3cd] text-[#856404]">📅 {formatDate(p.date)}</span>
                    <span className="px-2 py-1 text-xs font-semibold rounded bg-[#1e88e5] text-white">⏰ {p.start_time}</span>
                  </div>
                  <h4 className="text-[#0a2540] font-bold text-base mb-1">{p.title}</h4>
                  <p className="text-sm text-[#6b7280] mb-2">{p.detail}</p>
                  <div className="flex gap-3 text-xs text-[#6b7280]">
                    <span>⏱️ {p.hours}h</span>
                    <span>📚 {p.module_id}</span>
                  </div>
                </div>
                <div className="text-2xl text-[#6b7280]">→</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
EOF

echo "✅ ¡Actualización completada! La app ahora replica la lógica exacta de tu HTML."
echo "🌐 Abre tu navegador en http://localhost:5173/ y recarga la página (Ctrl + F5)."
