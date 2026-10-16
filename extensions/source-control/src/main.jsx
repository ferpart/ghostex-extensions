import { render } from 'preact';
import { projectPathOf, useGhostexContext } from './shared/bridge.js';
import './shared/base.css';
import './styles.css';

function App() {
  const { context, error } = useGhostexContext();
  if (error) return <div class="gx-error">{error.message}</div>;
  return <div class="gx-section-header">SOURCE CONTROL · {projectPathOf(context) ?? 'loading'}</div>;
}

render(<App />, document.getElementById('root'));
