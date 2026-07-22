import Button from '../../components/ui/Button.jsx';

export default function WorldIntroOverlay({ intro, onDismiss }) {
  if (!intro) return null;

  const title = [intro.name, intro.subtitle].filter(Boolean).join('：');

  return (
    <div className="world-intro-overlay" role="dialog" aria-modal="true" aria-labelledby="world-intro-title">
      <div className="world-intro-card">
        <div className="ui-eyebrow">世界开场</div>
        <h2 id="world-intro-title">{title || '进入世界'}</h2>

        {intro.playerRole && (
          <section className="world-intro-section">
            <h3>你的身份</h3>
            <p>{intro.playerRole}</p>
          </section>
        )}

        {intro.summary && (
          <section className="world-intro-section">
            <h3>当前处境</h3>
            <p>{intro.summary}</p>
          </section>
        )}

        {intro.environment && (
          <section className="world-intro-section">
            <h3>环境</h3>
            <p>{intro.environment}</p>
          </section>
        )}

        <div className="world-intro-actions">
          <Button variant="primary" onClick={onDismiss}>
            进入现场
          </Button>
        </div>
      </div>
    </div>
  );
}
