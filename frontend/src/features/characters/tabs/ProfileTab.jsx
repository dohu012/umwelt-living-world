export default function ProfileTab({ fields, setField, locations = [] }) {
  return (
    <div className="form-grid">
      <label className="field span-2">
        <span>名称</span>
        <input value={fields.name} onChange={setField('name')} required />
      </label>
      <label className="field span-2">
        <span>描述</span>
        <textarea rows={4} value={fields.description} onChange={setField('description')} required />
      </label>
      <label className="field">
        <span>性格</span>
        <textarea rows={4} value={fields.personality} onChange={setField('personality')} />
      </label>
      <label className="field">
        <span>场景设定</span>
        <textarea rows={4} value={fields.scenario} onChange={setField('scenario')} />
      </label>
      <label className="field">
        <span>开场白</span>
        <textarea rows={3} value={fields.first_mes} onChange={setField('first_mes')} />
      </label>
      <label className="field">
        <span>系统提示词</span>
        <textarea rows={3} value={fields.system_prompt} onChange={setField('system_prompt')} />
      </label>
      <label className="field">
        <span>备用问候语</span>
        <textarea rows={3} value={fields.alternate_greetings} onChange={setField('alternate_greetings')} />
      </label>
      <label className="field">
        <span>初始地点</span>
        <select value={fields.location ?? ''} onChange={setField('location')}>
          <option value="">使用世界默认 Start</option>
          {locations.map((location) => (
            <option key={location.id} value={location.id}>
              {location.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>历史后置指令</span>
        <textarea rows={3} value={fields.post_history_instructions} onChange={setField('post_history_instructions')} />
      </label>
      <label className="field">
        <span>标签</span>
        <input value={fields.tags} onChange={setField('tags')} placeholder="用英文逗号分隔" />
      </label>
      <label className="field">
        <span>创建者</span>
        <input value={fields.creator} onChange={setField('creator')} />
      </label>
      <label className="field span-2">
        <span>创建者备注</span>
        <textarea rows={3} value={fields.creator_notes} onChange={setField('creator_notes')} />
      </label>
    </div>
  );
}
