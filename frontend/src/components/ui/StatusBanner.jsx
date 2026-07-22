export default function StatusBanner({ children, tone = 'info', className = '' }) {
  return <div className={`status-banner ${tone} ${className}`.trim()}>{children}</div>;
}
