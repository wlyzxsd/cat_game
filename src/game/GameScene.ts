import Phaser from 'phaser';

const CAT_SPEED = 380;
const GROUND_Y = 580;
const START_LIVES = 3;
const CATCH_DISTANCE = 50;
const SPAWN_DELAY_MS = 900;
const FALL_SPEED = 200;
const FALL_SPEED_PER_FISH = 8; // каждая пойманная рыбка ускоряет падение
const MAX_FALL_SPEED = 520;
const BONES_CHANCE = 0.3;

type ItemKind = 'fish' | 'bones';

interface FallingItem {
  view: Phaser.GameObjects.Container;
  kind: ItemKind;
}

/**
 * Котик бегает по полу, сверху падают рыбки и рыбьи скелеты.
 * Рыбка — +1 к счёту. Скелет — котик пугается и теряет жизнь.
 * Жизни кончились — Game Over, пробел начинает заново.
 * Чем больше рыбок поймано, тем быстрее всё падает.
 */
export class GameScene extends Phaser.Scene {
  private cat!: Phaser.GameObjects.Container;
  private items: FallingItem[] = [];
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<'left' | 'right', Phaser.Input.Keyboard.Key>;
  private restartKey!: Phaser.Input.Keyboard.Key;
  private scoreText!: Phaser.GameObjects.Text;
  private livesText!: Phaser.GameObjects.Text;
  private messageText!: Phaser.GameObjects.Text;
  private spawnTimer?: Phaser.Time.TimerEvent;
  private score = 0;
  private lives = START_LIVES;
  private isPlaying = false;
  private isGameOver = false;

  // Не сбрасывается в create(), поэтому рекорд сохраняется между попытками.
  private bestScore = 0;

  constructor() {
    super('GameScene');
  }

  create(data: { skipIntro?: boolean }): void {
    const { width, height } = this.scale;

    // При scene.restart() конструктор не вызывается, поэтому сбрасываем здесь.
    this.items = [];
    this.score = 0;
    this.lives = START_LIVES;
    this.isPlaying = false;
    this.isGameOver = false;

    this.add
      .text(width / 2, 24, 'Стрелки / A D — бег. Лови рыбку, костей бойся!', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '18px',
        color: '#e9d5ff',
      })
      .setOrigin(0.5, 0);

    this.add.rectangle(width / 2, GROUND_Y, width, height - GROUND_Y, 0x3b2a55).setOrigin(0.5, 0);

    this.cat = this.createCat(width / 2, GROUND_Y);

    this.scoreText = this.add.text(24, height - 44, 'Рыбок: 0', {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '22px',
      color: '#ffffff',
    });

    this.livesText = this.add
      .text(width - 24, height - 44, this.livesLabel(), {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '22px',
        color: '#fda4af',
      })
      .setOrigin(1, 0);

    this.messageText = this.add
      .text(width / 2, height / 2 - 40, '', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '30px',
        color: '#ffffff',
        align: 'center',
      })
      .setOrigin(0.5);

    if (!this.input.keyboard) {
      throw new Error('Keyboard input is unavailable.');
    }

    this.cursors = this.input.keyboard.createCursorKeys();
    this.wasd = this.input.keyboard.addKeys({
      left: Phaser.Input.Keyboard.KeyCodes.A,
      right: Phaser.Input.Keyboard.KeyCodes.D,
    }) as Record<'left' | 'right', Phaser.Input.Keyboard.Key>;
    this.restartKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);

    // Правила показываем только при первом запуске, после Game Over — сразу игра.
    if (data.skipIntro) {
      this.startGame();
    } else {
      this.messageText.setText(
        'Лови рыбок: каждая даёт +1\nСкелет отнимает жизнь, их всего 3\nРыбки падают всё быстрее\n\nПробел — начать',
      );
    }
  }

  update(_time: number, delta: number): void {
    if (!this.isPlaying) {
      if (Phaser.Input.Keyboard.JustDown(this.restartKey)) {
        if (this.isGameOver) {
          this.scene.restart({ skipIntro: true });
        } else {
          this.startGame();
        }
      }
      return;
    }

    const seconds = delta / 1000;
    let dx = 0;

    if (this.cursors.left.isDown || this.wasd.left.isDown) dx -= 1;
    if (this.cursors.right.isDown || this.wasd.right.isDown) dx += 1;

    this.cat.x += dx * CAT_SPEED * seconds;

    this.keepCatOnScreen();
    this.updateItems(seconds);
  }

  // Серый котик анфас. Точка (0, 0) контейнера — его лапки на полу.
  private createCat(x: number, y: number): Phaser.GameObjects.Container {
    const fur = 0x9ca3af;

    // Точки треугольника задаются от левого верхнего угла (0, 0).
    const earLeft = this.add.triangle(-14, -92, 0, 18, 9, 0, 18, 18, fur);
    const earRight = this.add.triangle(14, -92, 0, 18, 9, 0, 18, 18, fur);

    // Хвост 
    const tail = this.add.ellipse(30, -6, 44, 12, fur);
    const body = this.add.ellipse(0, -28, 56, 56, fur);
    const head = this.add.circle(0, -70, 24, fur);
    const eyeLeft = this.add.circle(-9, -72, 3.5, 0x1f2937);
    const eyeRight = this.add.circle(9, -72, 3.5, 0x1f2937);

    // Нос
    const nose = this.add.triangle(0, -62, 0, 0, 7, 0, 3.5, 4, 0xf9a8d4);

    // Рот
    const mouth = [
      this.catLine(0, -60, -3, -57, 0x1f2937),
      this.catLine(-3, -57, -6, -59, 0x1f2937),
      this.catLine(0, -60, 3, -57, 0x1f2937),
      this.catLine(3, -57, 6, -59, 0x1f2937),
    ];
    const whiskers = [
      this.catLine(-8, -62, -32, -66, 0xe5e7eb),
      this.catLine(-8, -60, -32, -58, 0xe5e7eb),
      this.catLine(8, -62, 32, -66, 0xe5e7eb),
      this.catLine(8, -60, 32, -58, 0xe5e7eb),
    ];

    return this.add.container(x, y, [
      earLeft,
      earRight,
      tail,
      body,
      head,
      eyeLeft,
      eyeRight,
      nose,
      ...mouth,
      ...whiskers,
    ]);
  }

  // Линия для усов и рта
  private catLine(x1: number, y1: number, x2: number, y2: number, color: number): Phaser.GameObjects.Line {
    return this.add.line(0, 0, x1, y1, x2, y2, color).setOrigin(0).setLineWidth(1.5);
  }

  // Рыбка 
  private createFish(x: number, y: number): Phaser.GameObjects.Container {
    const color = 0x7dd3fc;
    const tail = this.add.triangle(-22, 0, 0, 0, 14, 10, 0, 20, color);
    const body = this.add.ellipse(0, 0, 36, 20, color);
    const eye = this.add.circle(9, -3, 2.5, 0x0f172a);
    return this.add.container(x, y, [tail, body, eye]);
  }

  // Рыбий скелет
  private createBones(x: number, y: number): Phaser.GameObjects.Container {
    const bone = 0xe5e7eb;
    const tail = this.add.triangle(-26, 0, 0, 0, 10, 8, 0, 16, bone);
    const spine = this.add.rectangle(-6, 0, 32, 3, bone);
    const rib1 = this.add.rectangle(-14, 0, 2, 16, bone);
    const rib2 = this.add.rectangle(-8, 0, 2, 18, bone);
    const rib3 = this.add.rectangle(-2, 0, 2, 16, bone);
    const head = this.add.circle(14, 0, 9, bone);
    const eye = this.add.circle(16, -2, 2.5, 0x2a1b3d);
    return this.add.container(x, y, [tail, spine, rib1, rib2, rib3, head, eye]);
  }

  private startGame(): void {
    this.isPlaying = true;
    this.messageText.setText('');
    this.spawnTimer = this.time.addEvent({
      delay: SPAWN_DELAY_MS,
      loop: true,
      callback: () => this.spawnItem(),
    });
  }

  private currentFallSpeed(): number {
    return Math.min(FALL_SPEED + this.score * FALL_SPEED_PER_FISH, MAX_FALL_SPEED);
  }

  private spawnItem(): void {
    const x = Phaser.Math.Between(40, this.scale.width - 40);
    const y = 70;
    const kind: ItemKind = Math.random() < BONES_CHANCE ? 'bones' : 'fish';
    const view = kind === 'fish' ? this.createFish(x, y) : this.createBones(x, y);

    this.items.push({ view, kind });
  }

  private updateItems(seconds: number): void {

    // Идём с конца, чтобы безопасно удалять элементы из массива.
    const speed = this.currentFallSpeed();

    for (let i = this.items.length - 1; i >= 0; i -= 1) {
      const item = this.items[i];
      item.view.y += speed * seconds;

      const distance = Phaser.Math.Distance.Between(
        this.cat.x,
        this.cat.y - 50,
        item.view.x,
        item.view.y,
      );

      if (distance <= CATCH_DISTANCE) {
        this.removeItem(i);
        this.onCatch(item);
      } else if (item.view.y > GROUND_Y) {
        this.removeItem(i);
      }

      if (this.isGameOver) return;
    }
  }

  private onCatch(item: FallingItem): void {
    if (item.kind === 'fish') {
      this.score += 1;
      this.scoreText.setText(`Рыбок: ${this.score}`);
      this.showPopup('+1', '#fde047');
      return;
    }

    this.lives -= 1;
    this.livesText.setText(this.livesLabel());
    this.showPopup('-1 ♥', '#f87171');
    this.blinkCat();

    if (this.lives <= 0) {
      this.endGame();
    }
  }

  // Надпись над котиком, которая всплывает и исчезает
  private showPopup(label: string, color: string): void {
    const popup = this.add
      .text(this.cat.x, this.cat.y - 110, label, {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '26px',
        color,
      })
      .setOrigin(0.5);

    this.tweens.add({
      targets: popup,
      y: popup.y - 40,
      alpha: 0,
      duration: 700,
      onComplete: () => popup.destroy(),
    });
  }

  // Котик мигает, когда пугается скелета
  private blinkCat(): void {
    this.tweens.add({
      targets: this.cat,
      alpha: 0.2,
      duration: 80,
      yoyo: true,
      repeat: 2,
      onComplete: () => this.cat.setAlpha(1),
    });
  }

  private removeItem(index: number): void {
    this.items[index].view.destroy();
    this.items.splice(index, 1);
  }

  private endGame(): void {
    this.isPlaying = false;
    this.isGameOver = true;
    this.spawnTimer?.remove();

    // Убираем оставшиеся предметы, чтобы они не закрывали надпись
    this.items.forEach((item) => item.view.destroy());
    this.items = [];
    this.bestScore = Math.max(this.bestScore, this.score);
    this.messageText.setText(
      `Котик напуган!\nПоймано рыбок: ${this.score}\nРекорд: ${this.bestScore}\n\nПробел — ещё раз`,
    );
  }

  private keepCatOnScreen(): void {
    const half = 40;
    this.cat.x = Phaser.Math.Clamp(this.cat.x, half, this.scale.width - half);
  }

  private livesLabel(): string {
    return `Жизни: ${'♥'.repeat(this.lives)}`;
  }
}