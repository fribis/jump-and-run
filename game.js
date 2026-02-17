const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const livesEl = document.getElementById('lives');

// --- Constants ---
const TILE = 32;
const GRAVITY = 0.6;
const JUMP_FORCE = -12;
const MOVE_SPEED = 4;
const COLS = 200; // level width in tiles
const ROWS = 15;  // level height in tiles
const VIEW_W = canvas.width;
const VIEW_H = canvas.height;

// --- Game State ---
let score = 0;
let lives = 3;
let gameOver = false;
let gameWon = false;
let camera = { x: 0 };

// --- Input ---
const keys = {};
window.addEventListener('keydown', e => { keys[e.key] = true; e.preventDefault(); });
window.addEventListener('keyup', e => { keys[e.key] = false; });

// --- Level Data ---
// 0=air, 1=ground, 2=brick, 3=question block, 4=pipe_tl, 5=pipe_tr, 6=pipe_bl, 7=pipe_br, 8=flag
const level = [];
for (let r = 0; r < ROWS; r++) {
    level[r] = new Array(COLS).fill(0);
}

function buildLevel() {
    // Ground layer (row 13 and 14)
    for (let c = 0; c < COLS; c++) {
        level[13][c] = 1;
        level[14][c] = 1;
    }

    // Gaps in ground
    const gaps = [[15, 17], [38, 40], [68, 70], [120, 122]];
    for (const [start, end] of gaps) {
        for (let c = start; c <= end; c++) {
            level[13][c] = 0;
            level[14][c] = 0;
        }
    }

    // Brick platforms
    const brickRows = [
        { row: 9, cols: [8, 9, 10, 11] },
        { row: 9, cols: [22, 23, 24, 25, 26] },
        { row: 7, cols: [30, 31, 32, 33] },
        { row: 9, cols: [45, 46, 47] },
        { row: 6, cols: [50, 51, 52, 53, 54] },
        { row: 9, cols: [60, 61, 62, 63, 64, 65] },
        { row: 7, cols: [75, 76, 77, 78] },
        { row: 9, cols: [85, 86, 87, 88] },
        { row: 5, cols: [90, 91, 92] },
        { row: 9, cols: [100, 101, 102, 103] },
        { row: 7, cols: [108, 109, 110, 111, 112] },
        { row: 9, cols: [130, 131, 132, 133, 134] },
        { row: 6, cols: [140, 141, 142, 143] },
        { row: 9, cols: [150, 151, 152] },
        { row: 8, cols: [160, 161, 162, 163] },
        { row: 9, cols: [170, 171, 172, 173, 174, 175] },
    ];
    for (const { row, cols } of brickRows) {
        for (const c of cols) {
            level[row][c] = 2;
        }
    }

    // Question blocks (contain coins)
    const questionBlocks = [
        [9, 10], [9, 24], [7, 32], [9, 46], [6, 52],
        [9, 63], [7, 76], [9, 87], [5, 91],
        [9, 102], [7, 110], [9, 132], [6, 142],
        [9, 151], [8, 162], [9, 173]
    ];
    for (const [r, c] of questionBlocks) {
        level[r][c] = 3;
    }

    // Pipes
    const pipePositions = [20, 42, 72, 95, 115, 145, 168];
    for (const c of pipePositions) {
        level[11][c] = 4;
        level[11][c + 1] = 5;
        level[12][c] = 6;
        level[12][c + 1] = 7;
    }

    // Staircase near end
    for (let i = 0; i < 8; i++) {
        for (let j = 0; j <= i; j++) {
            level[12 - j][180 + i] = 2;
        }
    }

    // Flag at end
    level[4][192] = 8;
    for (let r = 5; r < 13; r++) {
        level[r][192] = 8;
    }
}

buildLevel();

// --- Entities ---
const player = {
    x: 3 * TILE,
    y: 11 * TILE,
    w: 24,
    h: 30,
    vx: 0,
    vy: 0,
    onGround: false,
    facing: 1, // 1=right, -1=left
    frame: 0,
    frameTimer: 0,
};

const startPos = { x: player.x, y: player.y };

// Enemies - type: 'goomba' or 'koopa'
const enemies = [];
const enemySpawns = [
    // [column, type]
    [12, 'goomba'], [18, 'goomba'], [28, 'koopa'], [35, 'goomba'],
    [48, 'goomba'], [55, 'koopa'], [65, 'goomba'], [78, 'koopa'],
    [88, 'goomba'], [98, 'koopa'], [105, 'goomba'], [113, 'koopa'],
    [125, 'goomba'], [135, 'koopa'], [148, 'goomba'], [155, 'koopa'],
    [165, 'goomba'], [175, 'koopa']
];
for (const [c, type] of enemySpawns) {
    const isKoopa = type === 'koopa';
    enemies.push({
        type,
        x: c * TILE,
        y: (isKoopa ? 11 : 12) * TILE,
        w: isKoopa ? 26 : 28,
        h: isKoopa ? 36 : 28,
        vx: isKoopa ? -1.8 : -1.2,
        vy: 0,
        onGround: false,
        jumpTimer: Math.random() * 120 | 0,
        alive: true,
        shell: false,       // koopa only: retreated into shell
        shellTimer: 0,      // time in shell before re-emerging
        frame: 0,
        frameTimer: 0,
    });
}

// Coins (from question blocks)
const coins = [];
const hitBlocks = new Set();

// Particles
const particles = [];

// --- Collision Helpers ---
function getTile(px, py) {
    const c = Math.floor(px / TILE);
    const r = Math.floor(py / TILE);
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return 0;
    return level[r][c];
}

function isSolid(tile) {
    return tile === 1 || tile === 2 || tile === 3 || tile >= 4 && tile <= 7;
}

function rectCollide(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x &&
           a.y < b.y + b.h && a.y + a.h > b.y;
}

// --- Player Physics ---
function updatePlayer() {
    if (gameOver || gameWon) return;

    // Input
    let moveX = 0;
    if (keys['ArrowLeft'] || keys['a'] || keys['A']) moveX = -1;
    if (keys['ArrowRight'] || keys['d'] || keys['D']) moveX = 1;
    const jump = keys['ArrowUp'] || keys['w'] || keys['W'] || keys[' '];

    player.vx = moveX * MOVE_SPEED;
    if (moveX !== 0) player.facing = moveX;

    if (jump && player.onGround) {
        player.vy = JUMP_FORCE;
        player.onGround = false;
    }

    player.vy += GRAVITY;
    if (player.vy > 12) player.vy = 12;

    // Horizontal movement + collision
    player.x += player.vx;
    if (player.x < 0) player.x = 0;

    // Left/right collision
    const pLeft = player.x;
    const pRight = player.x + player.w;
    const pTop = player.y;
    const pBot = player.y + player.h;

    for (let r = Math.floor(pTop / TILE); r <= Math.floor((pBot - 1) / TILE); r++) {
        for (let c = Math.floor(pLeft / TILE); c <= Math.floor((pRight - 1) / TILE); c++) {
            if (isSolid(getTile(c * TILE, r * TILE))) {
                if (player.vx > 0) {
                    player.x = c * TILE - player.w;
                } else if (player.vx < 0) {
                    player.x = (c + 1) * TILE;
                }
            }
        }
    }

    // Vertical movement + collision
    player.y += player.vy;
    player.onGround = false;

    const pLeft2 = player.x;
    const pRight2 = player.x + player.w;
    const pTop2 = player.y;
    const pBot2 = player.y + player.h;

    for (let r = Math.floor(pTop2 / TILE); r <= Math.floor((pBot2 - 1) / TILE); r++) {
        for (let c = Math.floor(pLeft2 / TILE); c <= Math.floor((pRight2 - 1) / TILE); c++) {
            if (isSolid(getTile(c * TILE, r * TILE))) {
                if (player.vy > 0) {
                    player.y = r * TILE - player.h;
                    player.vy = 0;
                    player.onGround = true;
                } else if (player.vy < 0) {
                    player.y = (r + 1) * TILE;
                    player.vy = 0;
                    // Hit question block from below
                    hitBlock(r, c);
                }
            }
        }
    }

    // Fall into pit
    if (player.y > ROWS * TILE) {
        loseLife();
    }

    // Animation
    if (Math.abs(player.vx) > 0.5 && player.onGround) {
        player.frameTimer++;
        if (player.frameTimer > 6) {
            player.frame = (player.frame + 1) % 3;
            player.frameTimer = 0;
        }
    } else if (!player.onGround) {
        player.frame = 2;
    } else {
        player.frame = 0;
    }

    // Check flag
    const flagTile = getTile(player.x + player.w / 2, player.y + player.h / 2);
    if (flagTile === 8) {
        gameWon = true;
        score += 500;
    }
}

function hitBlock(r, c) {
    const key = `${r},${c}`;
    if (level[r][c] === 3 && !hitBlocks.has(key)) {
        hitBlocks.add(key);
        score += 10;
        // Spawn coin particle
        coins.push({
            x: c * TILE + 8,
            y: r * TILE - 16,
            vy: -6,
            life: 30,
        });
        // Particles
        for (let i = 0; i < 5; i++) {
            particles.push({
                x: c * TILE + 16,
                y: r * TILE,
                vx: (Math.random() - 0.5) * 4,
                vy: -Math.random() * 4 - 2,
                life: 20 + Math.random() * 10,
                color: '#FFD700',
                size: 3,
            });
        }
    }
}

function loseLife() {
    lives--;
    if (lives <= 0) {
        gameOver = true;
    } else {
        player.x = startPos.x;
        player.y = startPos.y;
        player.vx = 0;
        player.vy = 0;
        camera.x = 0;
    }
}

// --- Enemy AI ---
function updateEnemies() {
    if (gameOver || gameWon) return;

    for (const e of enemies) {
        if (!e.alive) continue;

        // Only update enemies near the camera
        if (Math.abs(e.x - camera.x) > VIEW_W + 200) continue;

        e.x += e.vx;
        e.frameTimer++;
        if (e.frameTimer > 10) {
            e.frame = (e.frame + 1) % 2;
            e.frameTimer = 0;
        }

        // Gravity
        e.vy += GRAVITY;
        if (e.vy > 12) e.vy = 12;
        e.y += e.vy;
        e.onGround = false;

        // Ground / vertical collision
        const eBot = e.y + e.h;
        for (let r = Math.floor(e.y / TILE); r <= Math.floor((eBot - 1) / TILE); r++) {
            for (let c = Math.floor(e.x / TILE); c <= Math.floor((e.x + e.w - 1) / TILE); c++) {
                if (r >= 0 && r < ROWS && c >= 0 && c < COLS && isSolid(level[r][c])) {
                    if (e.vy > 0) {
                        e.y = r * TILE - e.h;
                        e.vy = 0;
                        e.onGround = true;
                    } else if (e.vy < 0) {
                        e.y = (r + 1) * TILE;
                        e.vy = 0;
                    }
                }
            }
        }

        // Jump periodically when on ground (not when in shell)
        if (e.onGround && !e.shell) {
            e.jumpTimer--;
            if (e.jumpTimer <= 0) {
                const force = e.type === 'koopa' ? -11 - Math.random() * 2 : -9 - Math.random() * 3;
                e.vy = force;
                e.onGround = false;
                e.jumpTimer = e.type === 'koopa'
                    ? 40 + (Math.random() * 60 | 0)   // koopas jump more often
                    : 60 + (Math.random() * 80 | 0);
            }
        }

        // Shell logic for koopas
        if (e.shell) {
            e.shellTimer--;
            if (e.shellTimer <= 0) {
                // Re-emerge from shell
                e.shell = false;
                e.h = 36;
                e.y -= 8; // adjust position so it doesn't clip into ground
                e.vx = player.x > e.x ? -1.8 : 1.8; // walk away from player
            }
        }

        // Wall collision - reverse direction
        const ahead = getTile(e.x + (e.vx > 0 ? e.w : 0), e.y + e.h / 2);
        if (isSolid(ahead)) {
            e.vx *= -1;
        }

        // Edge detection (only when on ground)
        if (e.onGround) {
            const edgeX = e.vx > 0 ? e.x + e.w + 2 : e.x - 2;
            const edgeBelow = getTile(edgeX, e.y + e.h + 4);
            if (!isSolid(edgeBelow)) {
                e.vx *= -1;
            }
        }

        // Player collision
        if (rectCollide(player, e)) {
            if (player.vy > 0 && player.y + player.h - e.y < 16) {
                // Stomp from above!
                player.vy = JUMP_FORCE * 0.6;

                if (e.type === 'koopa' && !e.shell) {
                    // Koopa retreats into shell
                    e.shell = true;
                    e.shellTimer = 180; // 3 seconds in shell
                    e.vx = 0;
                    e.h = 24; // shorter in shell
                    e.y += 12; // adjust so it sits on ground
                    score += 15;
                    for (let i = 0; i < 4; i++) {
                        particles.push({
                            x: e.x + e.w / 2,
                            y: e.y,
                            vx: (Math.random() - 0.5) * 4,
                            vy: -Math.random() * 3 - 1,
                            life: 15,
                            color: '#228B22',
                            size: 3,
                        });
                    }
                } else {
                    // Kill goomba or shell-koopa
                    e.alive = false;
                    score += e.type === 'koopa' ? 40 : 20;
                    const color = e.type === 'koopa' ? '#228B22' : '#8B4513';
                    for (let i = 0; i < 8; i++) {
                        particles.push({
                            x: e.x + e.w / 2,
                            y: e.y + e.h,
                            vx: (Math.random() - 0.5) * 6,
                            vy: -Math.random() * 3,
                            life: 20,
                            color,
                            size: 4,
                        });
                    }
                }
            } else if (e.shell && e.vx === 0) {
                // Kick the shell!
                e.vx = player.x < e.x ? 6 : -6;
                score += 5;
            } else {
                loseLife();
            }
        }

        // Shell kills other enemies
        if (e.shell && Math.abs(e.vx) > 2) {
            for (const other of enemies) {
                if (other === e || !other.alive) continue;
                if (rectCollide(e, other)) {
                    other.alive = false;
                    score += 20;
                    for (let i = 0; i < 6; i++) {
                        particles.push({
                            x: other.x + other.w / 2,
                            y: other.y + other.h / 2,
                            vx: (Math.random() - 0.5) * 6,
                            vy: -Math.random() * 4,
                            life: 20,
                            color: other.type === 'koopa' ? '#228B22' : '#8B4513',
                            size: 4,
                        });
                    }
                }
            }
        }

        // Fall into pit
        if (e.y > ROWS * TILE) {
            e.alive = false;
        }
    }
}

// --- Particles ---
function updateParticles() {
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.2;
        p.life--;
        if (p.life <= 0) particles.splice(i, 1);
    }
}

function updateCoins() {
    for (let i = coins.length - 1; i >= 0; i--) {
        const c = coins[i];
        c.y += c.vy;
        c.vy += 0.3;
        c.life--;
        if (c.life <= 0) coins.splice(i, 1);
    }
}

// --- Camera ---
function updateCamera() {
    const target = player.x - VIEW_W / 3;
    camera.x += (target - camera.x) * 0.1;
    if (camera.x < 0) camera.x = 0;
    const maxCam = COLS * TILE - VIEW_W;
    if (camera.x > maxCam) camera.x = maxCam;
}

// --- Drawing ---
const COLORS = {
    sky: '#5C94FC',
    ground: '#C84C0C',
    groundDark: '#A03800',
    brick: '#D07030',
    brickLine: '#A05020',
    question: '#FFD700',
    questionDark: '#DAA520',
    pipe: '#00A800',
    pipeDark: '#006800',
    pipeHighlight: '#48D848',
    player: '#E52521',
    playerSkin: '#FFBD9D',
    playerShirt: '#E52521',
    playerPants: '#0038A8',
    enemy: '#8B4513',
    enemyDark: '#654321',
    flag: '#FFFFFF',
    flagPole: '#808080',
    flagTriangle: '#E52521',
    coin: '#FFD700',
    cloud: 'rgba(255,255,255,0.8)',
    hill: '#3AAA3A',
    hillDark: '#2A8A2A',
    bush: '#2A9A2A',
};

function drawBackground() {
    // Sky
    ctx.fillStyle = COLORS.sky;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    // Clouds
    const cloudPositions = [100, 350, 600, 900, 1300, 1800, 2400, 3000, 3600, 4200, 4800, 5400];
    for (const cx of cloudPositions) {
        const sx = cx - camera.x * 0.3;
        if (sx > -120 && sx < VIEW_W + 60) {
            drawCloud(sx, 40 + (cx % 80));
        }
    }

    // Hills
    const hillPositions = [50, 500, 1000, 1600, 2200, 2800, 3500, 4200, 5000, 5600];
    for (const hx of hillPositions) {
        const sx = hx - camera.x * 0.5;
        if (sx > -200 && sx < VIEW_W + 100) {
            drawHill(sx, 13 * TILE, 80 + (hx % 60));
        }
    }

    // Bushes
    const bushPositions = [200, 700, 1200, 1800, 2500, 3200, 3900, 4600, 5300];
    for (const bx of bushPositions) {
        const sx = bx - camera.x * 0.7;
        if (sx > -80 && sx < VIEW_W + 40) {
            drawBush(sx, 13 * TILE - 12);
        }
    }
}

function drawCloud(x, y) {
    ctx.fillStyle = COLORS.cloud;
    ctx.beginPath();
    ctx.arc(x, y, 20, 0, Math.PI * 2);
    ctx.arc(x + 25, y - 10, 25, 0, Math.PI * 2);
    ctx.arc(x + 50, y, 20, 0, Math.PI * 2);
    ctx.arc(x + 25, y + 5, 22, 0, Math.PI * 2);
    ctx.fill();
}

function drawHill(x, baseY, size) {
    ctx.fillStyle = COLORS.hill;
    ctx.beginPath();
    ctx.moveTo(x - size, baseY);
    ctx.quadraticCurveTo(x, baseY - size * 0.8, x + size, baseY);
    ctx.fill();
    ctx.fillStyle = COLORS.hillDark;
    ctx.beginPath();
    ctx.moveTo(x - size * 0.3, baseY);
    ctx.quadraticCurveTo(x, baseY - size * 0.5, x + size * 0.3, baseY);
    ctx.fill();
}

function drawBush(x, y) {
    ctx.fillStyle = COLORS.bush;
    ctx.beginPath();
    ctx.arc(x, y, 14, 0, Math.PI * 2);
    ctx.arc(x + 20, y - 4, 16, 0, Math.PI * 2);
    ctx.arc(x + 40, y, 14, 0, Math.PI * 2);
    ctx.fill();
}

function drawTiles() {
    const startCol = Math.floor(camera.x / TILE);
    const endCol = startCol + Math.ceil(VIEW_W / TILE) + 1;

    for (let r = 0; r < ROWS; r++) {
        for (let c = startCol; c <= endCol && c < COLS; c++) {
            const tile = level[r][c];
            if (tile === 0) continue;
            const sx = c * TILE - camera.x;
            const sy = r * TILE;

            switch (tile) {
                case 1: drawGroundTile(sx, sy); break;
                case 2: drawBrickTile(sx, sy); break;
                case 3: drawQuestionTile(sx, sy, r, c); break;
                case 4: drawPipeTile(sx, sy, 'tl'); break;
                case 5: drawPipeTile(sx, sy, 'tr'); break;
                case 6: drawPipeTile(sx, sy, 'bl'); break;
                case 7: drawPipeTile(sx, sy, 'br'); break;
                case 8: drawFlagTile(sx, sy, r); break;
            }
        }
    }
}

function drawGroundTile(x, y) {
    ctx.fillStyle = COLORS.ground;
    ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = COLORS.groundDark;
    ctx.fillRect(x, y, TILE, 2);
    // Small brick pattern
    ctx.strokeStyle = COLORS.groundDark;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 1, y + 1, TILE - 2, TILE - 2);
}

function drawBrickTile(x, y) {
    ctx.fillStyle = COLORS.brick;
    ctx.fillRect(x, y, TILE, TILE);
    ctx.strokeStyle = COLORS.brickLine;
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, TILE, TILE);
    // Brick lines
    ctx.beginPath();
    ctx.moveTo(x, y + TILE / 2);
    ctx.lineTo(x + TILE, y + TILE / 2);
    ctx.moveTo(x + TILE / 2, y);
    ctx.lineTo(x + TILE / 2, y + TILE / 2);
    ctx.moveTo(x + TILE / 4, y + TILE / 2);
    ctx.lineTo(x + TILE / 4, y + TILE);
    ctx.moveTo(x + TILE * 3 / 4, y + TILE / 2);
    ctx.lineTo(x + TILE * 3 / 4, y + TILE);
    ctx.stroke();
}

function drawQuestionTile(x, y, r, c) {
    const key = `${r},${c}`;
    if (hitBlocks.has(key)) {
        ctx.fillStyle = '#888';
        ctx.fillRect(x, y, TILE, TILE);
        ctx.strokeStyle = '#666';
        ctx.strokeRect(x, y, TILE, TILE);
        return;
    }
    const pulse = Math.sin(Date.now() / 200) * 0.15 + 0.85;
    ctx.fillStyle = COLORS.question;
    ctx.fillRect(x, y, TILE, TILE);
    ctx.strokeStyle = COLORS.questionDark;
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, TILE, TILE);
    // Question mark
    ctx.fillStyle = `rgba(139, 69, 19, ${pulse})`;
    ctx.font = 'bold 20px Courier New';
    ctx.textAlign = 'center';
    ctx.fillText('?', x + TILE / 2, y + TILE - 8);
    ctx.textAlign = 'left';
}

function drawPipeTile(x, y, part) {
    ctx.fillStyle = COLORS.pipe;
    ctx.fillRect(x, y, TILE, TILE);

    if (part === 'tl' || part === 'tr') {
        // Top rim
        ctx.fillStyle = COLORS.pipeDark;
        ctx.fillRect(x, y, TILE, 4);
        if (part === 'tl') {
            ctx.fillStyle = COLORS.pipeHighlight;
            ctx.fillRect(x + 2, y + 4, 6, TILE - 4);
        }
    } else {
        if (part === 'bl') {
            ctx.fillStyle = COLORS.pipeHighlight;
            ctx.fillRect(x + 4, y, 6, TILE);
        }
    }
    ctx.fillStyle = COLORS.pipeDark;
    if (part === 'tr' || part === 'br') {
        ctx.fillRect(x + TILE - 4, y, 4, TILE);
    }
    if (part === 'tl') {
        ctx.fillRect(x, y, 2, TILE);
    }
    if (part === 'bl') {
        ctx.fillRect(x, y, 2, TILE);
    }
}

function drawFlagTile(x, y, r) {
    // Pole
    ctx.fillStyle = COLORS.flagPole;
    ctx.fillRect(x + 14, y, 4, TILE);

    if (r === 4) {
        // Flag at top
        ctx.fillStyle = COLORS.flagTriangle;
        ctx.beginPath();
        ctx.moveTo(x + 14, y + 4);
        ctx.lineTo(x - 10, y + 14);
        ctx.lineTo(x + 14, y + 24);
        ctx.fill();
        // Ball on top
        ctx.fillStyle = '#FFD700';
        ctx.beginPath();
        ctx.arc(x + 16, y + 2, 4, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawPlayer() {
    const sx = player.x - camera.x;
    const sy = player.y;
    const f = player.facing;

    ctx.save();
    if (f === -1) {
        ctx.translate(sx + player.w, sy);
        ctx.scale(-1, 1);
    } else {
        ctx.translate(sx, sy);
    }

    // Hat
    ctx.fillStyle = COLORS.playerShirt;
    ctx.fillRect(4, 0, 16, 6);
    ctx.fillRect(2, 2, 20, 4);

    // Head
    ctx.fillStyle = COLORS.playerSkin;
    ctx.fillRect(4, 6, 16, 8);

    // Eyes
    ctx.fillStyle = '#000';
    ctx.fillRect(14, 8, 3, 3);

    // Mustache
    ctx.fillStyle = '#4A2800';
    ctx.fillRect(10, 12, 10, 2);

    // Body / Shirt
    ctx.fillStyle = COLORS.playerShirt;
    ctx.fillRect(4, 14, 16, 8);

    // Overalls
    ctx.fillStyle = COLORS.playerPants;
    ctx.fillRect(4, 18, 6, 8);
    ctx.fillRect(14, 18, 6, 8);

    // Legs animation
    if (player.frame === 1 && player.onGround) {
        ctx.fillRect(2, 24, 6, 6);
        ctx.fillRect(16, 24, 6, 6);
    } else if (player.frame === 2 && !player.onGround) {
        ctx.fillRect(2, 22, 6, 8);
        ctx.fillRect(16, 22, 6, 8);
    } else {
        ctx.fillRect(4, 24, 6, 6);
        ctx.fillRect(14, 24, 6, 6);
    }

    // Shoes
    ctx.fillStyle = '#8B4513';
    ctx.fillRect(2, 28, 8, 2);
    ctx.fillRect(14, 28, 8, 2);

    ctx.restore();
}

function drawEnemies() {
    for (const e of enemies) {
        if (!e.alive) continue;
        const sx = e.x - camera.x;
        if (sx < -TILE || sx > VIEW_W + TILE) continue;

        if (e.type === 'koopa') {
            drawKoopa(e, sx);
        } else {
            drawGoomba(e, sx);
        }
    }
}

function drawGoomba(e, sx) {
    // Body
    ctx.fillStyle = COLORS.enemy;
    ctx.fillRect(sx + 2, e.y + 4, 24, 18);

    // Head (rounded)
    ctx.beginPath();
    ctx.fillStyle = COLORS.enemy;
    ctx.arc(sx + 14, e.y + 8, 12, Math.PI, 0);
    ctx.fill();

    // Eyes
    ctx.fillStyle = '#FFF';
    ctx.fillRect(sx + 6, e.y + 6, 6, 6);
    ctx.fillRect(sx + 16, e.y + 6, 6, 6);
    ctx.fillStyle = '#000';
    const eyeOff = e.vx > 0 ? 2 : 0;
    ctx.fillRect(sx + 8 + eyeOff, e.y + 8, 3, 3);
    ctx.fillRect(sx + 18 + eyeOff, e.y + 8, 3, 3);

    // Eyebrows (angry)
    ctx.fillStyle = COLORS.enemyDark;
    ctx.fillRect(sx + 5, e.y + 4, 8, 2);
    ctx.fillRect(sx + 15, e.y + 4, 8, 2);

    // Feet
    ctx.fillStyle = COLORS.enemyDark;
    if (e.frame === 0) {
        ctx.fillRect(sx + 2, e.y + 22, 8, 6);
        ctx.fillRect(sx + 18, e.y + 22, 8, 6);
    } else {
        ctx.fillRect(sx + 4, e.y + 22, 8, 6);
        ctx.fillRect(sx + 16, e.y + 22, 8, 6);
    }
}

function drawKoopa(e, sx) {
    if (e.shell) {
        // Shell mode - green rounded shell
        const blink = e.shellTimer < 60 && e.shellTimer % 10 < 5;
        ctx.fillStyle = blink ? '#90EE90' : '#228B22';
        ctx.beginPath();
        ctx.ellipse(sx + e.w / 2, e.y + e.h / 2, e.w / 2, e.h / 2, 0, 0, Math.PI * 2);
        ctx.fill();

        // Shell pattern
        ctx.strokeStyle = '#006400';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.ellipse(sx + e.w / 2, e.y + e.h / 2, e.w / 2 - 3, e.h / 2 - 3, 0, 0, Math.PI * 2);
        ctx.stroke();
        // Hexagon pattern on shell
        ctx.beginPath();
        ctx.moveTo(sx + 6, e.y + e.h / 2);
        ctx.lineTo(sx + e.w - 6, e.y + e.h / 2);
        ctx.stroke();

        // Shell highlight
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.beginPath();
        ctx.ellipse(sx + e.w / 2 - 3, e.y + e.h / 2 - 3, 4, 3, -0.5, 0, Math.PI * 2);
        ctx.fill();
        return;
    }

    // Full koopa - head
    ctx.fillStyle = '#AADD44';
    ctx.beginPath();
    ctx.arc(sx + 13, e.y + 8, 10, 0, Math.PI * 2);
    ctx.fill();

    // Eyes
    ctx.fillStyle = '#FFF';
    ctx.fillRect(sx + 8, e.y + 4, 6, 6);
    ctx.fillRect(sx + 16, e.y + 4, 6, 6);
    ctx.fillStyle = '#000';
    const eyeOff = e.vx > 0 ? 2 : 0;
    ctx.fillRect(sx + 10 + eyeOff, e.y + 6, 3, 3);
    ctx.fillRect(sx + 18 + eyeOff, e.y + 6, 3, 3);

    // Shell body
    ctx.fillStyle = '#228B22';
    ctx.beginPath();
    ctx.ellipse(sx + 13, e.y + 22, 12, 10, 0, 0, Math.PI * 2);
    ctx.fill();

    // Shell pattern
    ctx.strokeStyle = '#006400';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(sx + 13, e.y + 22, 9, 7, 0, 0, Math.PI * 2);
    ctx.stroke();

    // Shell highlight
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.beginPath();
    ctx.ellipse(sx + 9, e.y + 18, 4, 3, -0.3, 0, Math.PI * 2);
    ctx.fill();

    // Belly
    ctx.fillStyle = '#FFFFCC';
    ctx.fillRect(sx + 8, e.y + 26, 10, 4);

    // Feet
    ctx.fillStyle = '#DAA520';
    if (e.frame === 0) {
        ctx.fillRect(sx + 2, e.y + 30, 8, 6);
        ctx.fillRect(sx + 16, e.y + 30, 8, 6);
    } else {
        ctx.fillRect(sx + 4, e.y + 30, 8, 6);
        ctx.fillRect(sx + 14, e.y + 30, 8, 6);
    }
}

function drawCoins() {
    ctx.fillStyle = COLORS.coin;
    for (const c of coins) {
        const sx = c.x - camera.x;
        ctx.beginPath();
        ctx.arc(sx + 8, c.y + 8, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#DAA520';
        ctx.font = 'bold 10px Courier New';
        ctx.textAlign = 'center';
        ctx.fillText('$', sx + 8, c.y + 12);
        ctx.fillStyle = COLORS.coin;
        ctx.textAlign = 'left';
    }
}

function drawParticles() {
    for (const p of particles) {
        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.life / 30;
        ctx.fillRect(p.x - camera.x, p.y, p.size, p.size);
    }
    ctx.globalAlpha = 1;
}

function drawOverlay() {
    scoreEl.textContent = `Punkte: ${score}`;
    livesEl.textContent = `Leben: ${lives}`;

    if (gameOver) {
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillRect(0, 0, VIEW_W, VIEW_H);
        ctx.fillStyle = '#E52521';
        ctx.font = 'bold 48px Courier New';
        ctx.textAlign = 'center';
        ctx.fillText('GAME OVER', VIEW_W / 2, VIEW_H / 2 - 20);
        ctx.fillStyle = '#FFF';
        ctx.font = '24px Courier New';
        ctx.fillText(`Punkte: ${score}`, VIEW_W / 2, VIEW_H / 2 + 20);
        ctx.fillText('Leertaste zum Neustarten', VIEW_W / 2, VIEW_H / 2 + 60);
        ctx.textAlign = 'left';

        if (keys[' ']) restartGame();
    }

    if (gameWon) {
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillRect(0, 0, VIEW_W, VIEW_H);
        ctx.fillStyle = '#FFD700';
        ctx.font = 'bold 48px Courier New';
        ctx.textAlign = 'center';
        ctx.fillText('GEWONNEN!', VIEW_W / 2, VIEW_H / 2 - 20);
        ctx.fillStyle = '#FFF';
        ctx.font = '24px Courier New';
        ctx.fillText(`Punkte: ${score}`, VIEW_W / 2, VIEW_H / 2 + 20);
        ctx.fillText('Leertaste zum Neustarten', VIEW_W / 2, VIEW_H / 2 + 60);
        ctx.textAlign = 'left';

        if (keys[' ']) restartGame();
    }
}

function restartGame() {
    score = 0;
    lives = 3;
    gameOver = false;
    gameWon = false;
    player.x = startPos.x;
    player.y = startPos.y;
    player.vx = 0;
    player.vy = 0;
    camera.x = 0;
    hitBlocks.clear();
    coins.length = 0;
    particles.length = 0;
    // Reset enemies
    for (let i = 0; i < enemies.length; i++) {
        const [col, type] = enemySpawns[i];
        const isKoopa = type === 'koopa';
        enemies[i].x = col * TILE;
        enemies[i].y = (isKoopa ? 11 : 12) * TILE;
        enemies[i].w = isKoopa ? 26 : 28;
        enemies[i].h = isKoopa ? 36 : 28;
        enemies[i].vx = isKoopa ? -1.8 : -1.2;
        enemies[i].vy = 0;
        enemies[i].onGround = false;
        enemies[i].jumpTimer = Math.random() * 120 | 0;
        enemies[i].shell = false;
        enemies[i].shellTimer = 0;
        enemies[i].alive = true;
    }
    keys[' '] = false;
}

// --- Game Loop ---
function gameLoop() {
    updatePlayer();
    updateEnemies();
    updateCoins();
    updateParticles();
    updateCamera();

    drawBackground();
    drawTiles();
    drawCoins();
    drawParticles();
    drawEnemies();
    drawPlayer();
    drawOverlay();

    requestAnimationFrame(gameLoop);
}

gameLoop();
