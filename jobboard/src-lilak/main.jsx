import './strings.js'
import { createRoot } from 'react-dom/client'
import { tr } from 'lilak-ui/i18n.jsx'
import { RackService } from 'racklist'
import 'racklist/rack.css'
import def from './def.jsx'
import './flow/strings.js'
import FlowBoard from './flow/App.jsx'
import './flow/flow.css'

// The flow (one task: everything upstream, one path down) is the frame's first tab; it
// opens a job's editor through the frame (api.openItem).
const slots = { tabs: [{ id: 'flow', label: tr('tab_flow'), lead: true, render: (api) => <FlowBoard api={api} /> }] }

createRoot(document.getElementById('root')).render(<RackService def={def} slots={slots} />)
