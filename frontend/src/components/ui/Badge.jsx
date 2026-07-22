export default function Badge({ children, tone = 'neutral', className = '' }) {
  return <span className={`ui-badge ${tone} ${className}`.trim()}>{children}</span>;
}
