export default function Button({
  children,
  variant = 'default',
  size = 'md',
  className = '',
  type = 'button',
  active = false,
  ...props
}) {
  return (
    <button
      type={type}
      className={`ui-button ${variant} ${size} ${active ? 'active' : ''} ${className}`.trim()}
      {...props}
    >
      {children}
    </button>
  );
}
