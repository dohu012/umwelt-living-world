import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { api } from '../../api/client.js';
import { useActivePersona } from '../../hooks/useActivePersona.js';
import { useCurrentWorldId } from '../../hooks/useWorlds.js';
import Button from '../ui/Button.jsx';

function NavIcon({ name }) {
  const paths = {
    worlds: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M3.5 12h17" />
        <path d="M12 3.5c2.2 2.3 3.2 5.1 3.2 8.5s-1 6.2-3.2 8.5c-2.2-2.3-3.2-5.1-3.2-8.5s1-6.2 3.2-8.5Z" />
      </>
    ),
    play: (
      <>
        <path d="M8 5.6v12.8l10-6.4L8 5.6Z" />
      </>
    ),
    character: (
      <>
        <circle cx="12" cy="8" r="3.6" />
        <path d="M5.4 19c1.1-3.2 3.2-4.8 6.6-4.8s5.5 1.6 6.6 4.8" />
      </>
    ),
    inspect: (
      <>
        <path d="M4 7h16" />
        <path d="M4 12h16" />
        <path d="M4 17h10" />
        <circle cx="17" cy="17" r="2.4" />
      </>
    ),
    will: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M12 2.8v3.1M12 18.1v3.1M2.8 12h3.1M18.1 12h3.1" />
        <path d="m5.5 5.5 2.2 2.2M16.3 16.3l2.2 2.2M18.5 5.5l-2.2 2.2M7.7 16.3l-2.2 2.2" />
      </>
    ),
    persona: (
      <>
        <path d="M12 4.2 18.5 7.8v8.4L12 19.8l-6.5-3.6V7.8L12 4.2Z" />
        <path d="M9.3 11.2h5.4" />
        <path d="M12 8.5v5.4" />
      </>
    ),
    provider: (
      <>
        <path d="M7 7h10v10H7z" />
        <path d="M9.5 2.8v3" />
        <path d="M14.5 2.8v3" />
        <path d="M9.5 18.2v3" />
        <path d="M14.5 18.2v3" />
        <path d="M2.8 9.5h3" />
        <path d="M2.8 14.5h3" />
        <path d="M18.2 9.5h3" />
        <path d="M18.2 14.5h3" />
      </>
    ),
  };

  return (
    <svg className="sidebar-nav-icon" viewBox="0 0 24 24" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

export default function AppShell() {
  const worldId = useCurrentWorldId();
  const [activePersonaId, setActivePersonaId] = useActivePersona();
  const [playPending, setPlayPending] = useState(false);
  const [playError, setPlayError] = useState(null);
  const navigate = useNavigate();

  const handlePlay = async () => {
    if (!worldId) {
      navigate('/');
      return;
    }
    if (!activePersonaId) {
      navigate('/persona');
      return;
    }
    setPlayPending(true);
    setPlayError(null);
    try {
      const { location } = await api.post(`/api/worlds/${worldId}/personas/${activePersonaId}/enter`, {});
      navigate(`/worlds/${worldId}/play/${location}`);
    } catch (err) {
      setPlayError(err.message);
      if (/no persona/i.test(err.message)) {
        setActivePersonaId(null);
        navigate('/persona');
      }
    } finally {
      setPlayPending(false);
    }
  };

  const navLabel = (label, icon) => (
    <>
      <NavIcon name={icon} />
      <span className="sidebar-nav-text">{label}</span>
    </>
  );

  return (
    <div className="app-shell sidebar-hover-rail">
      <nav className="sidebar" aria-label="主导航">
        <div className="sidebar-title">
          <span className="brand-mark">U</span>
          <span className="brand-name">umwelt</span>
        </div>

        <div className="nav-section">
          <div className="nav-label">世界</div>
          <NavLink to="/" end title="世界总览">
            {navLabel('世界总览', 'worlds')}
          </NavLink>
          {worldId && (
            <Button className="nav-button" onClick={handlePlay} disabled={playPending} title="游玩">
              {navLabel(playPending ? '进入中...' : '游玩', 'play')}
            </Button>
          )}
        </div>

        {worldId && (
          <>
            <div className="nav-section">
              <div className="nav-label">构建</div>
              <NavLink to={`/worlds/${worldId}/characters`} title="角色">
                {navLabel('角色', 'character')}
              </NavLink>
            </div>
            <div className="nav-section">
              <div className="nav-label">观测</div>
              <NavLink to={`/worlds/${worldId}/simulation`} title="世界意志">
                {navLabel('世界意志', 'will')}
              </NavLink>
              <NavLink to={`/worlds/${worldId}/inspector`} title="调试台">
                {navLabel('调试台', 'inspect')}
              </NavLink>
            </div>
          </>
        )}

        <div className="nav-section">
          <div className="nav-label">设置</div>
          <NavLink to="/persona" title="玩家身份">
            {navLabel('玩家身份', 'persona')}
          </NavLink>
          <NavLink to="/settings/providers" title="模型服务">
            {navLabel('模型服务', 'provider')}
          </NavLink>
        </div>

        {playError && <div className="sidebar-error">{playError}</div>}
      </nav>
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}
