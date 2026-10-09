import './doubao-voice-guide.css';

export function DoubaoVoiceGuide() {
  return (
    <details className="aurelia-advanced-controls aurelia-doubao-voice-guide">
      <summary className="aurelia-help-link">豆包语音配置教程 · API Key / 复刻音色 ID / 开通语音模型</summary>
      <p className="aurelia-field-hint">按以下步骤完成配置，点击图片可在新窗口查看原图。</p>
      <h4>1. 获取 API Key</h4>
      <p className="aurelia-field-hint">
        在豆包语音控制台左侧打开「API Key」，创建或查看 API Key，点击眼睛图标显示后复制， 填入本页的「API
        Key」。
      </p>
      <a href="/assets/tutorials/doubao/api-key.png" target="_blank" rel="noreferrer">
        <img
          src="/assets/tutorials/doubao/api-key.png"
          alt="豆包 API Key 管理：点击眼睛图标查看 API Key"
          loading="lazy"
        />
      </a>
      <h4>2. 获取复刻音色 ID</h4>
      <p className="aurelia-field-hint">
        在左侧打开「声音复刻」，完成复刻后点击音色右侧的复制图标获取音色 ID。 本页模型选择「TTS2.0 -
        复刻音色」，在下方「音色库」新增音色并填入该 ID。
      </p>
      <a href="/assets/tutorials/doubao/voice-id.png" target="_blank" rel="noreferrer">
        <img
          src="/assets/tutorials/doubao/voice-id.png"
          alt="豆包声音复刻：点击音色右侧的复制图标获取音色 ID"
          loading="lazy"
        />
      </a>
      <h4>3. 开通语音模型</h4>
      <p className="aurelia-field-hint">
        在左侧打开「开通管理」，找到与所选模型对应的语音服务并完成开通，
        确认服务显示「已开通」且未暂停。图中「语音合成2.0」为开通后的示例。
      </p>
      <a href="/assets/tutorials/doubao/activate-model.png" target="_blank" rel="noreferrer">
        <img
          src="/assets/tutorials/doubao/activate-model.png"
          alt="豆包开通管理：确认对应语音服务已开通且未暂停"
          loading="lazy"
        />
      </a>
    </details>
  );
}
