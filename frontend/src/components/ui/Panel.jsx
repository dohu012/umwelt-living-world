export default function Panel({ children, title, eyebrow, actions, className = '' }) {
  return (
    <section className={`ui-panel ${className}`.trim()}>
      {(title || eyebrow || actions) && (
        <div className="ui-panel-head">
          <div>
            {eyebrow && <div className="ui-eyebrow">{eyebrow}</div>}
            {title && <h2>{title}</h2>}
          </div>
          {actions && <div className="ui-panel-actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}
