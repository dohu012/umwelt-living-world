export default function TagChip({ children, active = false, tone = 'neutral', onClick, title }) {
  const Component = onClick ? 'button' : 'span';
  return (
    <Component
      type={onClick ? 'button' : undefined}
      className={`tag-chip ${tone}${active ? ' active' : ''}`.trim()}
      onClick={onClick}
      title={title}
    >
      {children}
    </Component>
  );
}
