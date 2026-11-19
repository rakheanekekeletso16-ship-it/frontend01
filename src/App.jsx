import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

const api = async (path, options = {}) => {
 const response = await fetch(`${import.meta.env.VITE_API_URL || ''}/api${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  })
  if (response.status === 204) return null
  const body = await response.text()
  let data
  if (body) {
    try {
      data = JSON.parse(body)
    } catch {
      throw new Error(`The server returned an invalid response (${response.status}).`)
    }
  } else if (!response.ok) {
    throw new Error(`The request failed with status ${response.status}.`)
  } else {
    throw new Error('The server returned an empty response.')
  }
  if (!response.ok) throw new Error(data.error || `The request failed with status ${response.status}.`)
  return data
}

const money = (amount) => `M ${Number(amount || 0).toLocaleString('en-LS', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const displayDate = (date) => date ? new Date(date).toLocaleDateString('en-GB') : '—'
const sizes = ['SMALL', 'MEDIUM', 'LARGE']
const chartPalette = ['#2e6944', '#d2a24c', '#5a8dad', '#bb6b60', '#8a74a7']
const provinces = ['Gauteng', 'Free State', 'KwaZulu-Natal', 'Western Cape', 'Eastern Cape', 'Limpopo', 'Mpumalanga', 'North West']
const today = new Date()
const fetchDashboardData = () => Promise.all([
  api('/reports/summary'), api('/suppliers'), api('/fruits'), api('/vendors'),
  api('/stock'), api('/sales'), api('/purchases'),
])

function App() {
  const [page, setPage] = useState('Overview')
  const [summary, setSummary] = useState(null)
  const [suppliers, setSuppliers] = useState([])
  const [fruits, setFruits] = useState([])
  const [vendors, setVendors] = useState([])
  const [stock, setStock] = useState([])
  const [sales, setSales] = useState([])
  const [purchases, setPurchases] = useState([])
  const [report, setReport] = useState(null)
  const [reportLoading, setReportLoading] = useState(true)
  const [reportDates, setReportDates] = useState({ from: '', to: '' })
  const reportRequest = useRef(0)
  const [search, setSearch] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [editId, setEditId] = useState(null)
  const [masterForm, setMasterForm] = useState({})
  const [transaction, setTransaction] = useState({ partyId: '', paymentMethod: 'CASH', lines: [newLine()] })
  const [saving, setSaving] = useState(false)

  function newLine() {
    return { fruitId: '', packagingSize: 'SMALL', quantity: 1, unitCost: '' }
  }

  const refresh = useCallback(async () => {
    try {
      const [nextSummary, nextSuppliers, nextFruits, nextVendors, nextStock, nextSales, nextPurchases] = await fetchDashboardData()
      setSummary(nextSummary)
      setSuppliers(nextSuppliers)
      setFruits(nextFruits)
      setVendors(nextVendors)
      setStock(nextStock)
      setSales(nextSales)
      setPurchases(nextPurchases)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setLoading(false)
    }
  }, [])

  const requestReport = useCallback(async (dates) => {
    const requestId = ++reportRequest.current
    const params = new URLSearchParams()
    if (dates.from) params.set('from', dates.from)
    if (dates.to) params.set('to', dates.to)
    try {
      const nextReport = await api(`/reports?${params.toString()}`)
      if (requestId === reportRequest.current) setReport(nextReport)
    } catch (requestError) {
      if (requestId === reportRequest.current) setError(requestError.message)
    } finally {
      if (requestId === reportRequest.current) setReportLoading(false)
    }
  }, [])

  useEffect(() => {
    setLoading(true)
    refresh()
  }, [page, refresh])

  useEffect(() => {
    let active = true
    const requestId = ++reportRequest.current
    api('/reports')
      .then((nextReport) => {
        if (active && requestId === reportRequest.current) setReport(nextReport)
      })
      .catch((requestError) => {
        if (active && requestId === reportRequest.current) setError(requestError.message)
      })
      .finally(() => {
        if (active && requestId === reportRequest.current) setReportLoading(false)
      })
    return () => { active = false }
  }, [])

  const filteredVendors = useMemo(() => vendors.filter((vendor) =>
    `${vendor.vendorName} ${vendor.phoneNumber}`.toLowerCase().includes(search.toLowerCase()),
  ), [vendors, search])
  const activeVendors = useMemo(() => vendors.filter((vendor) => vendor.status === 'Available'), [vendors])

  async function submitMaster(event, type) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      const endpoint = type === 'supplier' ? '/suppliers' : type === 'vendor' ? '/vendors' : '/fruits'
      const method = editId ? 'PUT' : 'POST'
      const url = editId ? `${endpoint}/${editId}` : endpoint
      await api(url, { method, body: JSON.stringify(masterForm) })
      setNotice(`${type[0].toUpperCase()}${type.slice(1)} ${editId ? 'updated' : 'added'} successfully.`)
      setMasterForm({})
      setEditId(null)
      await refresh()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSaving(false)
    }
  }

  async function removeSupplier(supplier) {
    if (!window.confirm(`Delete ${supplier.business_name}?`)) return
    try {
      await api(`/suppliers/${supplier.supplier_id}`, { method: 'DELETE' })
      setNotice('Supplier deleted.')
      await refresh()
    } catch (requestError) {
      setError(requestError.message)
    }
  }

  async function removeVendor(vendor) {
    if (!window.confirm(`Remove ${vendor.vendorName} from active vendors? Vendors with sales will be marked unavailable to preserve their history.`)) return
    setError('')
    try {
      const result = await api(`/vendors/${vendor.vendorId}`, { method: 'DELETE' })
      if (editId === vendor.vendorId) {
        setEditId(null)
        setMasterForm({})
      }
      setNotice(result?.unavailable
        ? `${vendor.vendorName} marked unavailable to preserve its sales history.`
        : 'Vendor deleted.')
      await refresh()
    } catch (requestError) {
      setError(requestError.message)
    }
  }

  async function removeFruit(fruit) {
    if (!window.confirm(`Remove ${fruit.fruitName} from the active catalogue? Fruits with sales or purchase history will be marked unavailable to preserve those records.`)) return
    setError('')
    try {
      const result = await api(`/fruits/${fruit.fruitId}`, { method: 'DELETE' })
      if (editId === fruit.fruitId) {
        setEditId(null)
        setMasterForm({})
      }
      setNotice(result?.unavailable
        ? `${fruit.fruitName} marked unavailable to preserve its sales and purchase history.`
        : `${fruit.fruitName} deleted.`)
      await refresh()
    } catch (requestError) {
      setError(requestError.message)
    }
  }

  async function submitTransaction(event, type) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      const isSale = type === 'sale'
      const body = {
        [isSale ? 'vendorId' : 'supplierId']: Number(transaction.partyId),
        ...(isSale ? { paymentMethod: transaction.paymentMethod } : {}),
        items: transaction.lines.map((line) => ({
          fruitId: Number(line.fruitId),
          packagingSize: line.packagingSize,
          quantity: Number(line.quantity),
          ...(!isSale ? { unitCost: Number(line.unitCost) } : {}),
        })),
      }
      const result = await api(isSale ? '/sales' : '/purchases', { method: 'POST', body: JSON.stringify(body) })
      setNotice(isSale
        ? `Sale ${result.saleId} recorded — ${money(result.totalAmount)} (${result.paymentStatus.replace('_', ' ').toLowerCase()}).`
        : `Purchase ${result.purchaseId} recorded — ${money(result.totalAmount)}.`)
      setTransaction({ partyId: '', paymentMethod: 'CASH', lines: [newLine()] })
      await refresh()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSaving(false)
    }
  }

  async function loadReport(event) {
    event.preventDefault()
    setError('')
    setReportLoading(true)
    await requestReport(reportDates)
  }

  async function makePayment(sale) {
    const remaining = Number(sale.totalAmount) - Number(sale.amountPaid)
    const raw = window.prompt(`Outstanding balance: ${money(remaining)}. Enter payment amount:`)
    if (raw === null) return
    try {
      const result = await api(`/sales/${sale.saleId}/payments`, {
        method: 'POST',
        body: JSON.stringify({ amount: Number(raw) }),
      })
      setNotice(`Payment recorded. Remaining balance: ${money(result.outstandingBalance)}.`)
      await refresh()
    } catch (requestError) {
      setError(requestError.message)
    }
  }

  function startEdit(type, item) {
    setEditId(item.supplier_id || item.vendorId || item.fruitId)
    if (type === 'supplier') {
      setMasterForm({
        businessName: item.business_name, contactPerson: item.contact_person, phone: item.phone,
        province: item.province, address: item.address,
      })
    } else if (type === 'vendor') {
      setMasterForm({
        vendorName: item.vendorName, phoneNumber: item.phoneNumber,
        location: item.location, status: item.status,
      })
    } else {
      setMasterForm({
        fruitName: item.fruitName, description: item.description, status: item.status,
        prices: Object.fromEntries(sizes.map((size) => [size, item.prices?.[size] || ''])),
        packageStatuses: Object.fromEntries(sizes.map((size) => [size, item.packageStatuses?.[size] || 'Available'])),
      })
    }
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function updateLine(index, key, value) {
    setTransaction((current) => ({
      ...current,
      lines: current.lines.map((line, lineIndex) => lineIndex === index ? { ...line, [key]: value } : line),
    }))
  }

  const nav = ['Dashboard', 'Sales', 'Purchases', 'Inventory', 'Vendors', 'Suppliers', 'Fruits', 'Reports']
  const navIcons = ['dashboard', 'trend', 'cart', 'boxes', 'users', 'truck', 'fruit', 'chart']

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#" onClick={(event) => { event.preventDefault(); setPage('Overview') }}>
          <span className="brand-mark">B</span>
          <span><strong>Batloung</strong><small>FARM DISTRIBUTION</small></span>
        </a>
        <div className="nav-caption">WORKSPACE</div>
        <nav className="main-nav" aria-label="Main navigation">
          {nav.map((item, index) => (
            <button key={item} className={(page === (item === 'Dashboard' ? 'Overview' : item)) ? 'nav-item active' : 'nav-item'} onClick={() => { setPage(item === 'Dashboard' ? 'Overview' : item); setError(''); setNotice('') }}>
              <span className="nav-icon"><Icon name={navIcons[index]} /></span>{item}
              {item === 'Inventory' && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="status-light" />
          <span>Distribution system <small>Administrator</small></span>
        </div>
      </aside>

      <main className="main-area">
        <div className="fruit-header-banner" role="img" aria-label="Fresh assorted fruit" />
        <header className="topbar">
          <div className="breadcrumbs">Batloung Farm <span>/</span> <strong>{page === 'Overview' ? 'Dashboard' : page}</strong></div>
          <div className="topbar-right">
            <span className="today">{today.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</span>
            <div className="avatar">A</div>
          </div>
        </header>

        <div className="content">
          {notice && <div className="toast success" role="status">{notice}<button onClick={() => setNotice('')} aria-label="Dismiss">×</button></div>}
          {error && <div className="toast error" role="alert">{error}<button onClick={() => setError('')} aria-label="Dismiss">×</button></div>}
          {loading && <div className="loading-bar"><span /></div>}

          {page === 'Overview' && <Overview summary={summary} onNavigate={setPage} />}
          {page === 'Inventory' && <Inventory stock={stock} />}
          {page === 'Suppliers' && (
            <Suppliers suppliers={suppliers} form={masterForm} setForm={setMasterForm} editId={editId}
              saving={saving} onSubmit={(event) => submitMaster(event, 'supplier')}
              onEdit={(item) => startEdit('supplier', item)} onCancel={() => { setEditId(null); setMasterForm({}) }}
              onDelete={removeSupplier} />
          )}
          {page === 'Vendors' && (
            <Vendors vendors={filteredVendors} search={search} setSearch={setSearch} form={masterForm} setForm={setMasterForm}
              editId={editId} saving={saving} onSubmit={(event) => submitMaster(event, 'vendor')}
              hasArchived={vendors.some((vendor) => vendor.status === 'Unavailable')}
              onEdit={(item) => startEdit('vendor', item)} onDelete={removeVendor}
              onCancel={() => { setEditId(null); setMasterForm({}) }} />
          )}
          {page === 'Fruits' && (
            <Fruits fruits={fruits} form={masterForm} setForm={setMasterForm} editId={editId} saving={saving}
              onSubmit={(event) => submitMaster(event, 'fruit')} onEdit={(item) => startEdit('fruit', item)}
              onDelete={removeFruit} onCancel={() => { setEditId(null); setMasterForm({}) }} />
          )}
          {page === 'Sales' && (
            <Transactions type="sale" title="Record a sale" parties={activeVendors} fruits={fruits} stock={stock}
              transaction={transaction} setTransaction={setTransaction} updateLine={updateLine}
              saving={saving} onSubmit={(event) => submitTransaction(event, 'sale')} history={sales} onPay={makePayment} />
          )}
          {page === 'Purchases' && (
            <Transactions type="purchase" title="Record a purchase" parties={suppliers} fruits={fruits} stock={stock}
              transaction={transaction} setTransaction={setTransaction} updateLine={updateLine}
              saving={saving} onSubmit={(event) => submitTransaction(event, 'purchase')} history={purchases} />
          )}
          {page === 'Reports' && <Reports report={report} loading={reportLoading} dates={reportDates} setDates={setReportDates} onSubmit={loadReport} />}
        </div>
        <footer className="footer">
          <span className="footer-copy">© {today.getFullYear()} Batloung Farm Distribution</span>
          <span className="footer-tagline">Fresh produce, delivered with care</span>
          <span className="footer-location">Maseru, Lesotho</span>
        </footer>
      </main>
    </div>
  )
}

function PageHeading({ eyebrow, title, description, action }) {
  return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>{action}</div>
}

function Icon({ name, size = 20 }) {
  const paths = {
    location: <><path d="M12 21s6-5.4 6-11a6 6 0 1 0-12 0c0 5.6 6 11 6 11Z" /><circle cx="12" cy="10" r="2" /></>,
    dashboard: <><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" /></>,
    trend: <><path d="M4 16.5 9 11l3.5 3.5L20 6.5" /><path d="M14.5 6.5H20v5.5" /></>,
    cart: <><path d="M3.5 4.5h2l2.2 11h10.8l2.1-8H6.3" /><circle cx="9.5" cy="19" r="1.2" /><circle cx="17.5" cy="19" r="1.2" /></>,
    boxes: <><path d="m12 3.5 8 4.2v8.6l-8 4.2-8-4.2V7.7l8-4.2Z" /><path d="m4.5 7.8 7.5 4 7.5-4M12 12v8.2M8 5.7l8 4.2" /></>,
    users: <><circle cx="9" cy="8" r="3" /><path d="M3.5 19v-1.3a5.5 5.5 0 0 1 11 0V19h-11Z" /><path d="M16 5.5a3 3 0 0 1 0 5.8M17 14a4.5 4.5 0 0 1 3.5 4.4v.6H18" /></>,
    truck: <><path d="M3 6h11v11H3zM14 10h4l3 3v4h-7z" /><circle cx="7.5" cy="18" r="1.8" /><circle cx="17.5" cy="18" r="1.8" /><path d="M17 10v3h4" /></>,
    fruit: <><path d="M12 8.5c-1.4-1.1-3.1-1.3-4.8-.5-2.8 1.3-3.4 4.7-2 8.1 1.2 2.8 2.9 4.4 5 4.4 1 0 1.4-.5 2.4-.5s1.5.5 2.4.5c2.1 0 3.8-1.6 5-4.4 1.4-3.4.8-6.8-2-8.1-1.7-.8-3.4-.6-4.8.5" /><path d="M12 8c-.2-2.5 1-4.1 3.5-5" /><path d="M13.5 5c1.7-1.4 3.4-1.4 5-.7-.5 2-2 3.1-4.7 3.2" /></>,
    chart: <><path d="M4 20V4M4 20h17" /><rect x="7" y="12" width="3" height="5" rx=".7" /><rect x="12" y="8" width="3" height="9" rx=".7" /><rect x="17" y="5" width="3" height="12" rx=".7" /></>,
    clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3.5 2" /></>,
    leaf: <><path d="M19.5 4.5C11 4.5 6 6.2 5 11c-.8 3.7 2.2 6.5 5.4 5.5 4.4-1.3 7.6-5.3 9.1-12Z" /><path d="M4 20c2.8-4.2 6.1-6.8 10.5-9" /></>,
    clipboard: <><rect x="5" y="5" width="14" height="16" rx="2" /><path d="M9 5V3.5h6V5M8.5 10h7M8.5 14h7M8.5 18h4" /></>,
    emptyBox: <><path d="m12 3.5 8 4.2v8.6l-8 4.2-8-4.2V7.7l8-4.2Z" /><path d="m4.5 7.8 7.5 4 7.5-4M12 12v8.2" /></>,
  }

  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name] || paths.dashboard}</svg>
}

function Overview({ summary, onNavigate }) {
  const stats = [
    { label: 'Total sales', value: summary ? money(summary.revenue) : '—', change: 'Paid invoices', icon: 'trend', tone: 'green' },
    { label: 'Boxes in stock', value: summary ? Number(summary.boxesInStock).toLocaleString() : '—', change: 'Across all sizes', icon: 'boxes', tone: 'amber' },
    { label: 'Registered vendors', value: summary?.vendorCount ?? '—', change: 'Active customers', icon: 'users', tone: 'blue' },
    { label: 'Outstanding', value: summary ? money(summary.outstanding) : '—', change: 'Vendor balances', icon: 'clock', tone: 'rose' },
  ]
  return <>
    <PageHeading eyebrow="DISTRIBUTION SNAPSHOT" title="Welcome back, Admin" description="Here is what is happening across your distribution business today."
      action={<button className="button secondary" onClick={() => onNavigate('Reports')}>View reports <span>↗</span></button>} />
    <div className="stats-grid">{stats.map((stat) => <div className="stat-card" key={stat.label}>
      <div className={`stat-icon ${stat.tone}`}><Icon name={stat.icon} size={19} /></div><span className="stat-label">{stat.label}</span>
      <strong className="stat-value">{stat.value}</strong><span className="stat-change">{stat.change}</span>
    </div>)}</div>
    <div className="overview-grid">
      <section className="panel recent-panel">
        <div className="panel-heading"><div><h2>Recent sales</h2><p>Your latest vendor orders</p></div><button className="text-button" onClick={() => onNavigate('Sales')}>All sales <span>→</span></button></div>
        {summary?.recentSales?.length ? <div className="table-wrap"><table><thead><tr><th>ORDER</th><th>VENDOR</th><th>DATE</th><th>AMOUNT</th><th>STATUS</th></tr></thead>
          <tbody>{summary.recentSales.map((sale) => <tr key={sale.saleId}><td className="order-id">#SL-{String(sale.saleId).padStart(4, '0')}</td>
            <td>{sale.vendorName}</td><td>{displayDate(sale.saleDate)}</td><td className="amount">{money(sale.totalAmount)}</td><td><Status status={sale.paymentStatus} /></td></tr>)}</tbody>
        </table></div> : <EmptyState text={summary ? 'No sales have been recorded yet.' : 'Connect to the database to load sales.'} />}
      </section>
      <section className="panel quick-panel">
        <div className="panel-heading"><div><h2>Quick actions</h2><p>Common tasks, one click away</p></div></div>
        <div className="quick-list">
          <button onClick={() => onNavigate('Sales')}><span className="quick-icon sales-icon"><Icon name="trend" /></span><span><strong>New sale</strong><small>Record a vendor order</small></span><b>→</b></button>
          <button onClick={() => onNavigate('Purchases')}><span className="quick-icon purchase-icon"><Icon name="cart" /></span><span><strong>New purchase</strong><small>Restock from a supplier</small></span><b>→</b></button>
          <button onClick={() => onNavigate('Inventory')}><span className="quick-icon stock-icon"><Icon name="boxes" /></span><span><strong>Check inventory</strong><small>Review package stock levels</small></span><b>→</b></button>
        </div>
      </section>
    </div>
    <div className="welcome-strip"><div className="welcome-art"><Icon name="leaf" size={23} /></div><div><strong>Fresh produce, delivered right.</strong><p>Manage your suppliers, stock and vendor payments from one place.</p></div><button onClick={() => onNavigate('Inventory')}>Explore inventory <span>→</span></button></div>
  </>
}

function Inventory({ stock }) {
  const low = stock.filter((item) => item.quantity <= 10)
  const groupedStock = [...stock.reduce((groups, item) => {
    const fruit = groups.get(item.fruitId) || {
      fruitId: item.fruitId,
      fruitName: item.fruitName,
      packages: {},
    }
    fruit.packages[item.packagingSize] = item
    groups.set(item.fruitId, fruit)
    return groups
  }, new Map()).values()]
  return <>
    <PageHeading eyebrow="STOCK CONTROL" title="Inventory" description="Monitor available boxes by fruit and packaging size." action={<span className="stock-count">{stock.reduce((sum, item) => sum + Number(item.quantity), 0)} boxes total</span>} />
    {low.length > 0 && <div className="notice-banner"><span>!</span><div><strong>{low.length} stock items need attention</strong><p>These package sizes have 10 boxes or fewer remaining.</p></div></div>}
    <section className="panel">
      <div className="panel-heading"><div><h2>Stock by packaging</h2><p>Each fruit appears once, with separate stock and pricing for each box size.</p></div></div>
      {groupedStock.length ? <div className="table-wrap"><table><thead><tr><th>FRUIT</th>{sizes.map((size) => <th key={size}>{size}</th>)}</tr></thead><tbody>
        {groupedStock.map((fruit) => <tr key={fruit.fruitId}>
          <td className="fruit-cell"><span className="fruit-emoji">{fruitEmoji(fruit.fruitName)}</span>{fruit.fruitName}</td>
          {sizes.map((size) => {
            const item = fruit.packages[size]
            return <td key={size}>{item ? <div className="inventory-package">
              <div className="inventory-package-detail">
                {item.status === 'Unavailable'
                  ?                   <strong className="low-number">Unavailable</strong>
                  : <strong className={item.quantity <= 10 ? 'low-number' : 'amount'}>{item.quantity} boxes</strong>}
                <span>{money(item.unitPrice)} / box</span>
              </div>
              <div className="level-track"><span className={item.status === 'Unavailable' || item.quantity <= 10 ? 'level-low' : ''} style={{ width: `${item.status === 'Unavailable' ? 0 : Math.min(100, item.quantity)}%` }} /></div>
            </div> : <span className="inventory-empty">—</span>}</td>
          })}
        </tr>)}
      </tbody></table></div> : <EmptyState text="No stock records found. Add fruits and record a purchase to get started." />}
    </section>
  </>
}

function Suppliers({ suppliers, form, setForm, editId, saving, onSubmit, onEdit, onCancel, onDelete }) {
  return <>
    <PageHeading eyebrow="PARTNER DIRECTORY" title="Suppliers" description="Manage the farms and produce businesses you buy from." action={<span className="count-badge">{suppliers.length} suppliers</span>} />
    <div className="management-grid">
      <section className="panel form-panel"><FormHeading title={editId ? 'Update supplier' : 'Add supplier'} />
        <form onSubmit={onSubmit} className="stack-form">
          <label>Business name<input required value={form.businessName || ''} onChange={(e) => setForm({ ...form, businessName: e.target.value })} placeholder="e.g. Highveld Fresh Produce" /></label>
          <label>Contact person<input required value={form.contactPerson || ''} onChange={(e) => setForm({ ...form, contactPerson: e.target.value })} placeholder="Full name" /></label>
          <label>Phone number<input required value={form.phone || ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+27 ..." /></label>
          <label>Province<select required value={form.province || ''} onChange={(e) => setForm({ ...form, province: e.target.value })}><option value="">Select province</option>{provinces.map((province) => <option key={province}>{province}</option>)}</select></label>
          <label>Address<input required value={form.address || ''} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Town, province" /></label>
          <FormActions saving={saving} editId={editId} onCancel={onCancel} />
        </form>
      </section>
      <section className="panel"><div className="panel-heading"><div><h2>Supplier directory</h2><p>Registered produce partners</p></div></div>
        {suppliers.length ? <div className="table-wrap"><table><thead><tr><th>BUSINESS</th><th>CONTACT</th><th>PROVINCE</th><th>PHONE</th><th /></tr></thead><tbody>
          {suppliers.map((item) => <tr key={item.supplier_id}><td><strong>{item.business_name}</strong><small className="sub-cell">{item.address}</small></td><td>{item.contact_person}</td><td>{item.province}</td><td>{item.phone}</td>
            <td><div className="row-actions"><button onClick={() => onEdit(item)}>Edit</button><button className="danger-action" onClick={() => onDelete(item)}>Delete</button></div></td></tr>)}
        </tbody></table></div> : <EmptyState text="No suppliers registered yet." />}
      </section>
    </div>
  </>
}

function Vendors({ vendors, search, setSearch, form, setForm, editId, saving, onSubmit, onEdit, onDelete, onCancel, hasArchived }) {
  const [showArchived, setShowArchived] = useState(false)
  const visibleVendors = vendors.filter((vendor) => showArchived || vendor.status === 'Available')
  const getVendorMapUrl = (item) => {
    const location = [item.location, 'Lesotho'].filter(Boolean).join(', ')
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`
  }

  return <>
    <PageHeading eyebrow="CUSTOMER DIRECTORY" title="Vendors" description="Keep vendor contact details and outstanding balances up to date." action={<span className="count-badge">{vendors.filter((vendor) => vendor.status === 'Available').length} available vendors</span>} />
    <div className="management-grid">
      <section className="panel form-panel"><FormHeading title={editId ? 'Update vendor' : 'Register vendor'} />
        <form onSubmit={onSubmit} className="stack-form">
          <label>Vendor name<input required value={form.vendorName || ''} onChange={(e) => setForm({ ...form, vendorName: e.target.value })} placeholder="Business or stall name" /></label>
          <label>Phone number<input required value={form.phoneNumber || ''} onChange={(e) => setForm({ ...form, phoneNumber: e.target.value })} placeholder="+266 ..." /></label>
          <label>Location<input required value={form.location || ''} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="Town or market" /></label>
          {editId && <label>Status<select value={form.status || 'Available'} onChange={(e) => setForm({ ...form, status: e.target.value })}><option value="Available">Available</option><option value="Unavailable">Unavailable</option></select></label>}
          <FormActions saving={saving} editId={editId} onCancel={onCancel} />
        </form>
      </section>
      <section className="panel"><div className="panel-heading directory-heading"><div><h2>Vendor directory</h2><p>Search by name or phone number</p></div><div className="directory-tools"><input className="search-input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search vendors..." />
        {hasArchived && <button className="row-button" type="button" onClick={() => setShowArchived((visible) => !visible)}>{showArchived ? 'Hide unavailable' : 'Show unavailable'}</button>}</div></div>
        {visibleVendors.length ? <div className="table-wrap"><table><thead><tr><th>VENDOR</th><th>PHONE</th><th>LOCATION</th><th>OUTSTANDING</th><th>STATUS</th><th>ACTIONS</th></tr></thead><tbody>
          {visibleVendors.map((item) => <tr key={item.vendorId}><td><strong>{item.vendorName}</strong><small className="sub-cell">Since {displayDate(item.registrationDate)}</small></td><td>{item.phoneNumber}</td><td><span className="vendor-location">{item.location}<a className="map-link" href={getVendorMapUrl(item)} target="_blank" rel="noopener noreferrer" aria-label={`Open ${item.vendorName} in Google Maps`} title="Open in Google Maps"><Icon name="location" size={16} /></a></span></td><td className={Number(item.outstandingBalance) > 0 ? 'low-number' : 'amount'}>{money(item.outstandingBalance)}</td>
            <td><Status status={item.status} /></td>
            <td><div className="row-actions"><button onClick={() => onEdit(item)}>Edit</button>{item.status === 'Available' && <button className="danger-action" onClick={() => onDelete(item)}>Delete</button>}</div></td></tr>)}
        </tbody></table></div> : <EmptyState text={showArchived ? 'No vendors match your search.' : 'No active vendors match your search.'} />}
      </section>
    </div>
  </>
}

function Fruits({ fruits, form, setForm, editId, saving, onSubmit, onEdit, onDelete, onCancel }) {
  const [showArchived, setShowArchived] = useState(false)
  const prices = form.prices || {}
  const packageStatuses = form.packageStatuses || {}
  const visibleFruits = fruits.filter((fruit) => showArchived || fruit.status === 'Available')
  function setPrice(size, value) { setForm({ ...form, prices: { ...prices, [size]: value } }) }
  function setPackageStatus(size, value) {
    setForm({ ...form, packageStatuses: { ...packageStatuses, [size]: value } })
  }
  return <>
    <PageHeading eyebrow="PRODUCT CATALOG" title="Fruit catalogue" description="Set selling prices separately for each packaging size." action={<span className="count-badge">{fruits.filter((fruit) => fruit.status === 'Available').length} available fruit types</span>} />
    <div className="management-grid">
      <section className="panel form-panel"><FormHeading title={editId ? 'Update fruit' : 'Add fruit type'} />
        <form onSubmit={onSubmit} className="stack-form">
          <label>Fruit name<input required value={form.fruitName || ''} onChange={(e) => setForm({ ...form, fruitName: e.target.value })} placeholder="e.g. Apples" /></label>
          <label>Description<input value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Short description" /></label>
          {editId && <label>Status<select value={form.status || 'Available'} onChange={(e) => setForm({ ...form, status: e.target.value })}><option value="Available">Available</option><option value="Unavailable">Unavailable</option></select></label>}
          <div className="price-fields"><span>Selling price and availability per box</span><div>{sizes.map((size) => <div className="package-field" key={size}>
            <strong>{size}</strong>
            <label>Price<input required type="number" min="0.01" step="0.01" value={prices[size] || ''} onChange={(e) => setPrice(size, e.target.value)} placeholder="M 0.00" /></label>
            {editId && <label>Status<select value={packageStatuses[size] || 'Available'} onChange={(e) => setPackageStatus(size, e.target.value)}><option value="Available">Available</option><option value="Unavailable">Unavailable</option></select></label>}
          </div>)}</div></div>
          <FormActions saving={saving} editId={editId} onCancel={onCancel} />
        </form>
      </section>
      <section className="panel"><div className="panel-heading"><div><h2>Fruit catalogue</h2><p>Available products and package pricing</p></div>
        {fruits.some((fruit) => fruit.status === 'Unavailable') && <button className="row-button" type="button" onClick={() => setShowArchived((visible) => !visible)}>{showArchived ? 'Hide unavailable' : 'Show unavailable'}</button>}</div>
        {visibleFruits.length ? <div className="table-wrap"><table><thead><tr><th>FRUIT</th><th>SMALL</th><th>MEDIUM</th><th>LARGE</th><th>STATUS</th><th>ACTIONS</th></tr></thead><tbody>
          {visibleFruits.map((item) => <tr key={item.fruitId}><td className="fruit-cell"><span className="fruit-emoji">{fruitEmoji(item.fruitName)}</span><span><strong>{item.fruitName}</strong><small className="sub-cell">{item.description}</small></span></td>
            {sizes.map((size) => <td key={size}>
              <strong>{money(item.prices?.[size])}</strong>
              <small className="sub-cell">{item.packageStatuses?.[size] || 'Available'}</small>
            </td>)}
            <td><Status status={item.status} /></td>
            <td><div className="row-actions"><button onClick={() => onEdit(item)}>Edit</button>{item.status === 'Available' && <button className="danger-action" onClick={() => onDelete(item)}>Delete</button>}</div></td></tr>)}
        </tbody></table></div> : <EmptyState text={showArchived ? 'No fruit records found.' : 'No available fruit. Show unavailable records or add a fruit type.'} />}
      </section>
    </div>
  </>
}

function Transactions({ type, title, parties, fruits, stock, transaction, setTransaction, updateLine, saving, onSubmit, history, onPay }) {
  const isSale = type === 'sale'
  const estimatedTotal = transaction.lines.reduce((sum, line) => {
    const fruit = fruits.find((item) => item.fruitId === Number(line.fruitId))
    const unitPrice = isSale ? fruit?.prices?.[line.packagingSize] : line.unitCost
    return sum + (Number(unitPrice) || 0) * (Number(line.quantity) || 0)
  }, 0)
  return <>
    <PageHeading eyebrow={isSale ? 'ORDER PROCESSING' : 'SUPPLIER RECEIVING'} title={isSale ? 'Sales' : 'Purchases'}
      description={isSale ? 'Create a vendor sale. Stock checks and totals are handled automatically.' : 'Record incoming produce and add it to the correct package stock.'} />
    <div className="transaction-grid">
      <section className="panel transaction-form"><FormHeading title={title} />
        <form onSubmit={onSubmit} className="stack-form">
          <label>{isSale ? 'Vendor' : 'Supplier'}<select required value={transaction.partyId} onChange={(e) => setTransaction({ ...transaction, partyId: e.target.value })}>
            <option value="">Choose {isSale ? 'vendor' : 'supplier'}</option>
            {parties.map((party) => <option key={party.vendorId || party.supplier_id} value={party.vendorId || party.supplier_id}>{party.vendorName || party.business_name}</option>)}
          </select></label>
          {isSale && <label>Payment method<select value={transaction.paymentMethod} onChange={(e) => setTransaction({ ...transaction, paymentMethod: e.target.value })}>
            <option value="CASH">Cash</option><option value="MOBILE_MONEY">Mobile money</option><option value="CREDIT">Outstanding (credit)</option>
          </select></label>}
          <div className="line-heading"><div><strong>Fruit items</strong><small>Add one or more packaging lines</small></div><button type="button" className="add-line" onClick={() => setTransaction({ ...transaction, lines: [...transaction.lines, newLine()] })}>+ Add item</button></div>
          {transaction.lines.map((line, index) => {
            const stockItem = stock.find((item) => item.fruitId === Number(line.fruitId) && item.packagingSize === line.packagingSize)
            const available = stockItem?.status === 'Unavailable' ? undefined : stockItem?.quantity
            const selectedFruit = fruits.find((fruit) => fruit.fruitId === Number(line.fruitId))
            return <div className="item-line" key={index}>
              <label>Fruit<select required value={line.fruitId} onChange={(e) => updateLine(index, 'fruitId', e.target.value)}><option value="">Select fruit</option>{fruits.filter((fruit) => fruit.status === 'Available').map((fruit) => <option key={fruit.fruitId} value={fruit.fruitId}>{fruit.fruitName}</option>)}</select></label>
              <label>Size<select value={line.packagingSize} onChange={(e) => updateLine(index, 'packagingSize', e.target.value)}>{sizes.map((size) => {
                const packageStatus = isSale
                  ? (selectedFruit?.packageStatuses?.[size] || stock.find((item) => item.fruitId === Number(line.fruitId) && item.packagingSize === size)?.status || 'Available')
                  : 'Available'
                return <option key={size} value={size} disabled={isSale && packageStatus === 'Unavailable'}>{size}{isSale && packageStatus === 'Unavailable' ? ' — Unavailable' : ''}</option>
              })}</select></label>
              <label>Boxes<input required type="number" min="1" step="1" value={line.quantity} onChange={(e) => updateLine(index, 'quantity', e.target.value)} /></label>
              {!isSale && <label>Unit cost<input required type="number" min="0.01" step="0.01" value={line.unitCost} onChange={(e) => updateLine(index, 'unitCost', e.target.value)} placeholder="M 0.00" /></label>}
              <div className="line-price">{isSale ? (line.fruitId ? `${money(fruits.find((fruit) => fruit.fruitId === Number(line.fruitId))?.prices?.[line.packagingSize])} / box${available !== undefined ? ` · ${available} in stock` : ''}` : 'Price set by catalogue') : 'Purchase cost'}</div>
              {transaction.lines.length > 1 && <button className="remove-line" type="button" onClick={() => setTransaction({ ...transaction, lines: transaction.lines.filter((_, lineIndex) => lineIndex !== index) })} aria-label="Remove item">×</button>}
            </div>
          })}
          <div className="total-row"><span>Estimated total</span><strong>{money(estimatedTotal)}</strong></div>
          <button className="button primary full-button" disabled={saving}>{saving ? 'Saving...' : isSale ? 'Complete sale' : 'Record purchase'} <span>→</span></button>
          {isSale && <small className="form-note">The complete sale is rejected if any requested fruit/package size is unavailable.</small>}
        </form>
      </section>
      <section className="panel history-panel"><div className="panel-heading"><div><h2>{isSale ? 'Sales records' : 'Purchase records'}</h2><p>Saved transactions and item details</p></div><span className="count-badge">{history.length} records</span></div>
        {history.length ? <div className="table-wrap"><table><thead><tr><th>{isSale ? 'VENDOR' : 'SUPPLIER'}</th><th>ITEMS</th><th>DATE</th><th>TOTAL</th>{isSale && <><th>PAID</th><th>OUTSTANDING</th><th>STATUS</th></>}</tr></thead><tbody>
          {history.map((item) => <tr key={item.saleId || item.purchaseId}><td><strong>{item.vendorName || item.supplierName}</strong>{isSale && <small className="sub-cell">{item.paymentMethod?.replace('_', ' ')}</small>}</td>
            <td><RecordItems items={item.items} isSale={isSale} /></td>
            <td>{displayDate(item.saleDate || item.purchaseDate)}</td><td className="amount">{money(item.totalAmount)}</td>
            {isSale && <>
              <td className="amount">{money(item.amountPaid)}</td>
              <td className={Number(item.totalAmount) > Number(item.amountPaid) ? 'low-number' : 'amount'}>{money(Number(item.totalAmount) - Number(item.amountPaid))}</td>
              <td><div className="status-cell"><Status status={item.paymentStatus} />{item.paymentStatus !== 'PAID' && <button className="pay-button" onClick={() => onPay(item)}>Add payment</button>}</div></td>
            </>}
          </tr>)}
        </tbody></table></div> : <EmptyState text="No transactions recorded yet." />}
      </section>
    </div>
  </>
}

function Reports({ report, loading, dates, setDates, onSubmit }) {
  const topFruits = report?.topFruits || []
  const totalBoxes = topFruits.reduce((sum, fruit) => sum + Number(fruit.boxesSold || 0), 0)
  const maxBoxes = topFruits.reduce((max, fruit) => Math.max(max, Number(fruit.boxesSold || 0)), 0)
  const pieSegments = topFruits.map((fruit, index) => {
    const value = Number(fruit.boxesSold || 0)
    const previousBoxes = topFruits.slice(0, index).reduce((sum, item) => sum + Number(item.boxesSold || 0), 0)
    const startAngle = totalBoxes ? (previousBoxes / totalBoxes) * 360 : 0
    const endAngle = totalBoxes ? ((previousBoxes + value) / totalBoxes) * 360 : startAngle
    return `${chartPalette[index % chartPalette.length]} ${startAngle}deg ${endAngle}deg`
  })

  return <>
    <PageHeading eyebrow="BUSINESS INTELLIGENCE" title="Reports" description="Review sales performance, best-selling fruit and vendor activity." />
    <section className="panel report-filter"><div><h2>Sales date range</h2><p>Set an optional date range to filter report metrics.</p></div>
      <form onSubmit={onSubmit}><label>From<input type="date" value={dates.from} onChange={(e) => setDates({ ...dates, from: e.target.value })} /></label>
        <label>To<input type="date" value={dates.to} onChange={(e) => setDates({ ...dates, to: e.target.value })} /></label>
        <button className="button primary" disabled={loading}>{loading ? 'Loading...' : 'Run report'} <span>→</span></button></form>
    </section>
    {report ? <div className="report-grid">
      <section className="panel report-card"><div className="eyebrow">SALES REVENUE</div><strong className="report-total">{money(report.totalRevenue)}</strong><p>Sales within the selected period</p></section>
      <section className="panel report-card top-vendor"><div className="eyebrow">TOP VENDOR BY BOXES</div><strong>{report.topVendor?.vendorName || 'No sales recorded'}</strong><p>{report.topVendor ? `${report.topVendor.boxesPurchased} boxes purchased` : 'Record a sale to see vendor performance.'}</p></section>
      <div className="report-visuals">
        <section className="panel report-card chart-card">
          <div className="chart-heading"><div><h2>Sales mix by fruit</h2><p>Share of boxes sold across the top fruits</p></div></div>
          {totalBoxes ? <div className="pie-layout">
            <div className="pie-chart" role="img" aria-label={`Pie chart of ${totalBoxes} boxes sold by fruit`} style={{ background: `conic-gradient(${pieSegments.join(', ')})` }} />
            <ul className="chart-legend">{topFruits.map((fruit, index) => (
              <li key={fruit.fruitName}><span className="legend-swatch" style={{ backgroundColor: chartPalette[index % chartPalette.length] }} />
                <span>{fruit.fruitName}</span><strong>{((Number(fruit.boxesSold || 0) / totalBoxes) * 100).toFixed(1)}%</strong>
              </li>
            ))}</ul>
          </div> : <EmptyState text="No fruit sales to chart for this date range." />}
        </section>
        <section className="panel report-card chart-card">
          <div className="chart-heading"><div><h2>Boxes sold by fruit</h2><p>Top fruits ranked by quantity</p></div></div>
          {topFruits.length ? <div className="bar-chart" role="list" aria-label="Boxes sold by fruit">
            {topFruits.map((fruit, index) => (
              <div className="bar-row" role="listitem" key={fruit.fruitName}>
                <div className="bar-label"><span>{fruit.fruitName}</span><strong>{Number(fruit.boxesSold || 0)} boxes</strong></div>
                <div className="bar-track"><span style={{ width: `${maxBoxes ? (Number(fruit.boxesSold || 0) / maxBoxes) * 100 : 0}%`, backgroundColor: chartPalette[index % chartPalette.length] }} /></div>
              </div>
            ))}
          </div> : <EmptyState text="No fruit sales to chart for this date range." />}
        </section>
      </div>
      <section className="panel report-table"><div className="panel-heading"><div><h2>Top 5 fruits</h2><p>Ranked by boxes sold</p></div></div>
        {topFruits.length ? <div className="table-wrap"><table><thead><tr><th>RANK</th><th>FRUIT</th><th>BOXES SOLD</th></tr></thead><tbody>{topFruits.map((fruit, index) => <tr key={fruit.fruitName}><td className="rank-cell">0{index + 1}</td><td className="fruit-cell"><span className="fruit-emoji">{fruitEmoji(fruit.fruitName)}</span>{fruit.fruitName}</td><td className="amount">{fruit.boxesSold}</td></tr>)}</tbody></table></div> : <EmptyState text="No fruit sales in the selected date range." />}
      </section>
    </div> : <div className="report-placeholder"><span><Icon name={loading ? 'clock' : 'chart'} size={23} /></span><h2>{loading ? 'Loading your report' : 'Your report is ready when you are'}</h2><p>{loading ? 'Fetching the latest sales metrics.' : 'Choose a date range and run the report to see sales metrics.'}</p></div>}
  </>
}

function Status({ status }) {
  const label = String(status || '').replace('_', ' ').toLowerCase()
  const displayLabel = label === 'available' ? 'Available' : label === 'unavailable' ? 'Unavailable' : label
  return <span className={`status-badge ${label.replace(' ', '-')}`}>{displayLabel}</span>
}

function EmptyState({ text }) { return <div className="empty-state"><span><Icon name="emptyBox" size={23} /></span><p>{text}</p></div> }
function RecordItems({ items, isSale }) {
  if (!items?.length) return <span className="inventory-empty">No item details</span>
  return <div className="record-items">{items.map((item, index) => (
    <span className="record-item" key={`${item.fruitName}-${item.packagingSize}-${index}`}>
      <strong>{item.fruitName}</strong>
      <small>{item.quantity} {item.packagingSize.toLowerCase()} boxes · {money(isSale ? item.unitPrice : item.unitCost)} / box</small>
    </span>
  ))}</div>
}
function FormHeading({ title }) { return <div className="form-heading"><span className="form-heading-icon"><Icon name="clipboard" size={18} /></span><div><h2>{title}</h2><p>Fields marked below are required.</p></div></div> }
function FormActions({ saving, editId, onCancel }) {
  return <div className="form-actions"><button className="button primary" disabled={saving}>{saving ? 'Saving...' : editId ? 'Save changes' : 'Save record'} <span>→</span></button>
    {editId && <button className="button secondary" type="button" onClick={onCancel}>Cancel</button>}</div>
}
function fruitEmoji(name = '') {
  const lower = name.toLowerCase()
  if (lower.includes('apple')) return '🍎'
  if (lower.includes('banana')) return '🍌'
  if (lower.includes('orange')) return '🍊'
  if (lower.includes('mango')) return '🥭'
  if (lower.includes('grape')) return '🍇'
  return '🍐'
}

export default App
