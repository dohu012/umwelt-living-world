export default function SplitPane({ main, side, className = '' }) {
  return (
    <div className={`split-pane ${className}`.trim()}>
      <div className="split-main">{main}</div>
      <aside className="split-side">{side}</aside>
    </div>
  );
}
