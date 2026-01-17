import * as PIXI from 'pixi.js';
import type { DesignObject } from '../types';

/**
 * Factory for creating and updating PixiJS display objects from DesignObject data
 */
export class ShapeFactory {
  /**
   * Parse a color string to a numeric value for PixiJS
   */
  private parseColor(color: string): number {
    if (color.startsWith('#')) {
      return parseInt(color.slice(1), 16);
    }
    if (color.startsWith('rgb')) {
      const match = color.match(/\d+/g);
      if (match && match.length >= 3) {
        const [r, g, b] = match.map(Number);
        return (r << 16) | (g << 8) | b;
      }
    }
    return 0x000000;
  }

  /**
   * Create a new PixiJS container for a design object
   */
  public createShape(obj: DesignObject): PIXI.Container {
    const container = new PIXI.Container();
    container.label = obj.id;

    // Create the appropriate shape
    switch (obj.type) {
      case 'rectangle':
      case 'frame':
        this.createRectangle(container, obj);
        break;
      case 'ellipse':
        this.createEllipse(container, obj);
        break;
      case 'text':
        this.createText(container, obj);
        break;
      case 'image':
        this.createImage(container, obj);
        break;
      case 'group':
        // Groups are just containers
        break;
    }

    // Apply common properties
    this.applyCommonProperties(container, obj);

    return container;
  }

  /**
   * Update an existing PixiJS container with new object data
   */
  public updateShape(container: PIXI.Container, obj: DesignObject): void {
    // Clear and recreate the shape content
    container.removeChildren();

    switch (obj.type) {
      case 'rectangle':
      case 'frame':
        this.createRectangle(container, obj);
        break;
      case 'ellipse':
        this.createEllipse(container, obj);
        break;
      case 'text':
        this.createText(container, obj);
        break;
      case 'image':
        this.createImage(container, obj);
        break;
    }

    // Apply common properties
    this.applyCommonProperties(container, obj);
  }

  private createRectangle(container: PIXI.Container, obj: DesignObject): void {
    const graphics = new PIXI.Graphics();

    // Fill
    graphics.fill({ color: this.parseColor(obj.fill) });
    graphics.rect(0, 0, obj.width, obj.height);
    graphics.fill();

    // Stroke
    if (obj.strokeWidth > 0) {
      graphics.setStrokeStyle({ width: obj.strokeWidth, color: this.parseColor(obj.stroke) });
      graphics.rect(0, 0, obj.width, obj.height);
      graphics.stroke();
    }

    container.addChild(graphics);
  }

  private createEllipse(container: PIXI.Container, obj: DesignObject): void {
    const graphics = new PIXI.Graphics();

    const cx = obj.width / 2;
    const cy = obj.height / 2;
    const rx = obj.width / 2;
    const ry = obj.height / 2;

    // Fill
    graphics.fill({ color: this.parseColor(obj.fill) });
    graphics.ellipse(cx, cy, rx, ry);
    graphics.fill();

    // Stroke
    if (obj.strokeWidth > 0) {
      graphics.setStrokeStyle({ width: obj.strokeWidth, color: this.parseColor(obj.stroke) });
      graphics.ellipse(cx, cy, rx, ry);
      graphics.stroke();
    }

    container.addChild(graphics);
  }

  private createText(container: PIXI.Container, obj: DesignObject): void {
    const style = new PIXI.TextStyle({
      fontFamily: obj.fontFamily || 'Inter, sans-serif',
      fontSize: obj.fontSize || 16,
      fontWeight: (obj.fontWeight as PIXI.TextStyleFontWeight) || 'normal',
      fill: this.parseColor(obj.fill),
      align: obj.textAlign || 'left',
    });

    const text = new PIXI.Text({
      text: obj.text || 'Text',
      style,
    });

    container.addChild(text);
  }

  private createImage(container: PIXI.Container, obj: DesignObject): void {
    if (obj.imageUrl) {
      // Load image asynchronously
      PIXI.Assets.load(obj.imageUrl).then((texture: PIXI.Texture) => {
        const sprite = new PIXI.Sprite(texture);
        sprite.width = obj.width;
        sprite.height = obj.height;
        container.addChild(sprite);
      }).catch((err) => {
        console.error('Failed to load image:', err);
        // Draw a placeholder
        this.createPlaceholder(container, obj);
      });
    } else {
      this.createPlaceholder(container, obj);
    }
  }

  private createPlaceholder(container: PIXI.Container, obj: DesignObject): void {
    const graphics = new PIXI.Graphics();
    graphics.fill({ color: 0xcccccc });
    graphics.rect(0, 0, obj.width, obj.height);
    graphics.fill();

    // Draw X pattern
    graphics.setStrokeStyle({ width: 1, color: 0x999999 });
    graphics.moveTo(0, 0);
    graphics.lineTo(obj.width, obj.height);
    graphics.moveTo(obj.width, 0);
    graphics.lineTo(0, obj.height);
    graphics.stroke();

    container.addChild(graphics);
  }

  private applyCommonProperties(container: PIXI.Container, obj: DesignObject): void {
    // Position
    container.position.set(obj.x, obj.y);

    // Opacity
    container.alpha = obj.opacity;

    // Rotation (around center)
    if (obj.rotation !== 0) {
      container.pivot.set(obj.width / 2, obj.height / 2);
      container.position.set(obj.x + obj.width / 2, obj.y + obj.height / 2);
      container.rotation = (obj.rotation * Math.PI) / 180;
    } else {
      container.pivot.set(0, 0);
      container.rotation = 0;
    }

    // Visibility
    container.visible = obj.visible;
  }
}
