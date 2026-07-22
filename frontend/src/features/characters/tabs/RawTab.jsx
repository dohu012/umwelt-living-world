import Button from '../../../components/ui/Button.jsx';

export default function RawTab({ rawJson, setRawJson, applyRaw }) {
  return (
    <div className="raw-editor">
      <textarea value={rawJson} onChange={(event) => setRawJson(event.target.value)} spellCheck={false} />
      <div className="form-actions">
        <Button onClick={applyRaw}>将 JSON 应用到表单</Button>
      </div>
    </div>
  );
}
