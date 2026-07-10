import { Board } from './components/Board'
import { ConnectionStatus } from './components/ConnectionStatus'

export default function App() {
  return (
    <main className="vg-app">
      <header className="vg-app__header">
        <h1>vidgen</h1>
        <ConnectionStatus />
      </header>
      <Board />
    </main>
  )
}
