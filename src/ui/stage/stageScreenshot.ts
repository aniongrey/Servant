import { downloadBlob } from '../../app/utils/downloadFile';
import { backgroundSource, type StageScene } from './stageScene';

export async function saveStageScreenshot(scene: StageScene, actors: HTMLCanvasElement): Promise<void> {
  const canvas = document.createElement('canvas');
  const { width, height } = actors;
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法创建截图');
  if (scene.background !== 'transparent') {
    context.save();
    context.translate(width * scene.view.x / 100 + width / 2, height * scene.view.y / 100 + height);
    context.scale(scene.view.zoom, scene.view.zoom);
    context.translate(-width / 2, -height);
    context.beginPath(); context.rect(0, 0, width, height); context.clip();
    context.filter = `brightness(${scene.brightness}) blur(${scene.blur * width / Math.max(1, window.innerWidth)}px)`;
    context.fillStyle = '#1e2433'; context.fillRect(0, 0, width, height);
    const source = backgroundSource(scene.background);
    if (source) {
      const image = new Image(); image.crossOrigin = 'anonymous'; image.src = source;
      await image.decode();
      const ratio = (scene.fit === 'cover' ? Math.max : Math.min)(width / image.naturalWidth, height / image.naturalHeight);
      const w = image.naturalWidth * ratio, h = image.naturalHeight * ratio;
      context.drawImage(image, (width - w) * scene.backgroundX / 100, (height - h) * scene.backgroundY / 100, w, h);
    }
    context.restore();
  }
  context.drawImage(actors, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('截图导出失败');
  downloadBlob(`Servant-stage-${Date.now()}.png`, blob);
}
