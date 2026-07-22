import { Route, Routes } from 'react-router-dom';
import Layout from './routes/Layout.jsx';
import WorldSelect from './routes/WorldSelect.jsx';
import CharacterList from './routes/CharacterList.jsx';
import CharacterForm from './routes/CharacterForm.jsx';
import PersonaEditor from './routes/PersonaEditor.jsx';
import ProviderSettings from './routes/ProviderSettings.jsx';
import ChatRoom from './routes/ChatRoom.jsx';
import InspectorPage from './features/inspector/InspectorPage.jsx';
import AppErrorBoundary from './components/layout/AppErrorBoundary.jsx';

export default function App() {
  return (
    <AppErrorBoundary>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<WorldSelect />} />
          <Route path="worlds/:worldId/characters" element={<CharacterList />} />
          <Route path="worlds/:worldId/characters/new" element={<CharacterForm mode="create" />} />
          <Route path="worlds/:worldId/characters/:agentId" element={<CharacterForm mode="edit" />} />
          <Route path="worlds/:worldId/characters/:agentId/edit" element={<CharacterForm mode="edit" />} />
          <Route path="worlds/:worldId/play/:location" element={<ChatRoom />} />
          <Route path="worlds/:worldId/rooms/:location" element={<ChatRoom />} />
          <Route path="worlds/:worldId/inspector" element={<InspectorPage />} />
          <Route path="persona" element={<PersonaEditor />} />
          <Route path="settings/providers" element={<ProviderSettings />} />
        </Route>
      </Routes>
    </AppErrorBoundary>
  );
}
