// Journey to Hedgeheart
// a platform jumper inspired by the google chrome "no internet" game
// but with graphics and gameplay influenced by my love for Cyan
// based on https://gamedevacademy.org/how-to-make-a-mario-style-platformer-with-phaser-3/


/* to do:
- what to do inbetween dates
- game width overlapping text on mid screen sizes
- collect apples
- high score
- sound off button
- first two obstacles don't kill if player hasn't moved
- more interesting background
- walk along start button
? better collision detection
? trees in background
X more obstacles (platforms? zebra? salamander?)
X better winner sequence
X fix play again button click area
X max and min spacing for each ostacle type
X when platform speed changes, update speed of all visible objects
X obstacle clusters (CACTUS CLUSTERS!)
X add sounds
X work on mobile
X scale to fit window size
X speed up platform as game proceeds
X increase scoring as game speeds up
X fix jumping movement
X space to start, space to play again
X better score display
X host online with domain
X create logo, favicon, name
X reset gameclock on new game
*/

/* Next version of J2HH
- city levels (Paris, Istanbul, London, New York)
- theme levels: food and drink, animals pt 2, modes of transport
- each level has different backgrounds, obstacles, colours
- dress up Hedgehog with extras like hats, tshirt, sunglasses
- add platforms?
- night mode
- Sun, moon, stars, clouds moving through sky
- weather: clouds, rain, fog, sun
- inbetween dates
- hedgehog has blaster that can fire wine/cheese at obstacle
*/


/* add AI interface to play game */

let dateOfMeetingInSeconds = new Date("2024-12-12T16:55:00");

let platformSpeed = 1;
let platToVelFactor = 60;
let groundHeight = 565;
let gravity = 2000;
let gameSpeedUpInterval = 10; //seconds
let gameSpeedUpFactor = 0.2; // addition to platform speed each interval
let obstacleMinGap = 4000;
let obstacleMaxGap = 9000;

let fontFamily = 'Nunito';

let gameState = 'before'; // what state is the game in? Just started? In play? Game over? before / during / after
let winner = false;

let player;
let cursors;
// Create an input state object to manage all player inputs
let inputState = {
    left: false,
    right: false,
    jump: false,
    down: false
};
let obstaclesArray = [];
let ground, groundCollider;

let score = Math.round((dateOfMeetingInSeconds - Date.now()) / 1000);
let scoreText;
let gameClock = 0;

// let buttonGroup;

let playerLRSoundCooldown = 250; // Cooldown time in milliseconds
let lastplayerLRSoundTime = 0; // Timestamp of the last time the sound played

let AIControl = true; // set to false to turn off websocket activity
let socket;
let WSreconnectInterval = 3000;
let WSretryCount = 0;
let WSmaxRetries = 5;
let WSSendNow = false;
let startingReward = 0;

// Initialize Phaser game
var config = {
    type: Phaser.AUTO,
    parent: 'game-container',
    width: 800,
    height: 600,
    scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_HORIZONTALLY,
        //width: window.innerWidth,
        //height: '100%',
    },
    backgroundColor: '#87CEEB', // Light blue sky color
    physics: {
        default: 'arcade',
        arcade: {
            gravity: { y: gravity },  // Gravity pulls the player down
            debug: false
        }
    },
    scene: {
        preload,
        create,
        update
    }
};

const game = new Phaser.Game(config);

function preload() {
    this.load.spritesheet('tiles', 'assets/tiles.png', { frameWidth: 70, frameHeight: 70 });
    this.load.image('hedgehog', 'assets/hedgehog.png');
    this.load.image('flamingo', 'assets/flamingo.png');
    this.load.image('crab', 'assets/crab.png');
    this.load.image('cactusL', 'assets/cactus.png');
    this.load.image('cactusS', 'assets/cactus.png');
    this.load.image('bird', 'assets/bird.png');
    this.load.image('cloud', 'assets/cloud.png');
    this.load.image('eagle', 'assets/eagle.png');
    this.load.image('lizard', 'assets/lizard.png');
    this.load.image('zebra', 'assets/zebra.png');
    this.load.image('cyanHeart', 'assets/cyanHeart.png');
    this.load.audio('obstacleHit', 'assets/sounds/obstacleHit.mp3');
    this.load.audio('obstaclePass', 'assets/sounds/obstaclePass.mp3');
    this.load.audio('playerJump', 'assets/sounds/playerJump.mp3');
    this.load.audio('playerLR', 'assets/sounds/playerLR.mp3');
    this.load.audio('winner', 'assets/sounds/winner.mp3');
}

function create() {

    sceneW = this.scale.width;
    sceneH = this.scale.height;

    // set the boundaries of our game world
    this.physics.world.bounds.width = sceneW;
    this.physics.world.bounds.height = sceneH;

    // Add a scrolling ground using tileSprite
    ground = this.add.tileSprite(sceneW / 2, groundHeight, sceneW, 70, 'tiles', 2);

    // create the player sprite    
    player = this.physics.add.sprite(0, 0, 'hedgehog');
    player.displayWidth = 100;
    player.scaleY = player.scaleX; // extra line to scale the image proportional
    player.flipX = true; // get the hedgehog facing the right way!
    // Place the sprite behind others using depth
    player.setDepth(99); // Depth of 99 puts the player in front of the background and obstacles

    player.body.setBounce(0.2); // our player will bounce from items
    player.body.setCollideWorldBounds(true); // don't go out of the map
    player.body.setVelocityX(platformSpeed * platToVelFactor * 30);

    // Create a static ground collider for the player to stand on
    groundCollider = this.physics.add.staticGroup();
    groundCollider.create(sceneW / 2, groundHeight - 28, 'tiles', 2).setDisplaySize(sceneW * 1.2, 0).refreshBody();
    this.physics.add.collider(player, groundCollider);

    scoreText = this.add.text(20, sceneH - 40, 'Score: ' + convertSecondsIntoText(score), {
        fontSize: '20px',
        fill: '#ffffff',
        fontFamily: fontFamily
    });
    scoreText.setScrollFactor(0);

    // Combine both keyboard and touch controls
    setupControls.call(this);

    // add sound mute button
    // soundMute = addButton(this, 'Mute');

    if (gameState === 'before') {
        // show a play now button
        playButton = addButton(this, 'Start game?');

        // On button click, restart the game
        playButton.on('pointerdown', () => {
            startGame(this, playButton);
        });
    }

    // Add keyboard listener to start or restart game 
    this.input.keyboard.on('keydown-SPACE', () => {
        if (gameState != 'during') startGame(this, playButton);
    });

    // Spawn obstacles with random delay
    addObstacleWithRandomDelay.call(this);

    // Add some clouds in the background
    addCloudsWithRandomDelay.call(this);

    // Subtract from the score every second
    this.time.addEvent({
        delay: 1000,              // 1000 milliseconds = 1 second
        callback: countGameTime,  // Function to call
        callbackScope: this,      // Scope of the callback function
        loop: true                // Repeat this event indefinitely
    });


    // Sounds
    this.obstacleHitSound = this.sound.add('obstacleHit');
    this.obstaclePassSound = this.sound.add('obstaclePass');
    this.playerJumpSound = this.sound.add('playerJump');
    this.playerLRSound = this.sound.add('playerLR', { volume: 0.2 });
    this.winnerSound = this.sound.add('winner');

    if(AIControl) connectWebSocket(this, playButton);
}

function connectWebSocket(scene, button) {
    // AI websocket remote playing

    // Check if WebSocket is already open or connecting
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
        console.log('WebSocket connection already open or connecting.');
        return;
    }

    // Connect to the WebSocket server
    socket = new WebSocket('ws://localhost:8081');

    socket.onopen = () => {
        console.log('Connected to WebSocket server');
        WSretryCount = 0;
    };

    // Handle incoming messages
    socket.onmessage = (event) => {
        console.log('WebSocket message received', event.data);
        const data = JSON.parse(event.data);
        if (data.action) {
            applyWebSocketAction(data.action, scene, button); // Handle action from server
        }
        WSSendNow = true;
    };

    socket.onclose = () => {
        console.log('Disconnected from WebSocket server');
        // reset and wait for new connections
        if (WSretryCount < WSmaxRetries) {
            WSretryCount++;
            setTimeout(() => connectWebSocket(scene, button), WSreconnectInterval);
        }
    };

    socket.onerror = (error) => {
        console.log('WebSocket error:', error);
        socket.close();  // Close the socket if there’s an error to trigger the onclose event
    };
}

function startGame(scene, killButton) {
    if (gameState === 'after') {
        // Reset the game state by restarting the scene
        scene.scene.restart();
    }
    gameState = 'during';
    gameClock = 0;
    platformSpeed = 2;
    score = Math.round((dateOfMeetingInSeconds - Date.now()) / 1000);
    obstaclesArray = [];
    winner = false;

    if (killButton) {
        // Tween for fading in the button background
        scene.tweens.add({
            targets: killButton,
            alpha: 0,  // Fade to fully invisible (alpha = 0)
            duration: 500,  // 1-second fade duration
            ease: 'Linear',
            onComplete: () => {
                killButton.destroy();  // Destroy the graphic
                killButton = null;     // Set to null to avoid errors on multiple clicks
            }
        });

    }
}


function countGameTime() {

    if (gameState === 'during') gameClock += 1;

    // decrease score time by 1 sec
    if (score > 0) {
        score -= 1; // Decrement score by one second
    }

    // increase platform speed and score multiples as the game progresses (every 20s)
    if ((gameClock > 0) && (gameClock % gameSpeedUpInterval === 0)) {
        platformSpeed += gameSpeedUpFactor;
        this.obstaclePassSound.setRate(this.obstaclePassSound.rate + 0.05);
    }

    // // for game state testing
    // gameStatusResponse()["state"].forEach(row => console.log(row.join('')));;
}

function addObstacleWithRandomDelay() {

    // add obstacles with a random delay related to the platform speed
    // (higher platform speed, more frequent obstacles)
    randomDelay = Phaser.Math.Between(1 / platformSpeed * obstacleMinGap, 1 / platformSpeed * obstacleMaxGap);
    this.time.addEvent({
        delay: randomDelay,
        callback: addObstacle,
        callbackScope: this,
        loop: false
    });
}

function addObstacle() {
    if (gameState === 'during') {

        // Obstacle array: 0. name, 1. speed factor, 2. starting height, 
        // 3. gravity, 4. width, 5. x-offset, 6. wobble, 7. depth, 8. score (seconds)
        let obstacles = [
            { name: 'cactusS', speedFactor: 1, startingHeight: 480, gravity: gravity, width: 80, xOffset: 0, tween: false, depth: 5, score: 3600 },
            { name: 'flamingo', speedFactor: 1.3, startingHeight: 480, gravity: gravity, width: 80, xOffset: 0, tween: 'wobble', depth: 10, score: 3600 },
            { name: 'crab', speedFactor: 0.8, startingHeight: 480, gravity: gravity, width: 80, xOffset: 0, tween: 'leftright', depth: 9, score: 3600 },
            { name: 'cactusL', speedFactor: 1, startingHeight: 460, gravity: gravity, width: 140, xOffset: 0, tween: false, depth: 4, score: 10800 },
            { name: 'bird', speedFactor: 2, startingHeight: 250, gravity: -gravity, width: 80, xOffset: 0, tween: 'updown', depth: 8, score: 7200 },
            { name: 'cactusCluster', speedFactor: 1, startingHeight: 450, gravity: gravity, width: 80, xOffset: 0, tween: false, depth: 5, score: 18000 },
            { name: 'eagle', speedFactor: 4, startingHeight: 150, gravity: -gravity, width: 100, xOffset: 0, tween: 'divebomb', depth: 11, score: 1000 },
            { name: 'zebra', speedFactor: 3, startingHeight: 450, gravity: gravity, width: 180, xOffset: 0, tween: 'trot', depth: 11, score: 10000 },
            { name: 'lizard', speedFactor: 5, startingHeight: 480, gravity: gravity, width: 70, xOffset: 0, tween: 'wobble', depth: 11, score: 0 }
        ];

        // Randomly select an obstacle - change this to add more obstacles over time
        let numberOfObsToChooseFrom = Math.min(obstacles.length, Math.round(platformSpeed * 3)); // higher multiple, greater obstacle mix
        let obCh = Phaser.Math.Between(0, numberOfObsToChooseFrom - 1);
        let chosenObstacle = obstacles[obCh];

        switch (chosenObstacle.name) {
            case 'cactusCluster':
                renderObstacle(this, { name: 'cactusL', speedFactor: 1, startingHeight: 460, gravity: gravity, width: 140, xOffset: 0, tween: false, depth: 4, score: chosenObstacle.score });
                renderObstacle(this, { name: 'cactusS', speedFactor: 1, startingHeight: 490, gravity: gravity, width: 80, xOffset: 60, tween: false, depth: 5, score: 0 });
                renderObstacle(this, { name: 'cactusS', speedFactor: 1, startingHeight: 490, gravity: gravity, width: 80, xOffset: -60, tween: false, depth: 5, score: 0 });
                break;
            default:
                renderObstacle(this, chosenObstacle);
                break;
        }
    }
    addObstacleWithRandomDelay.call(this);
}

function renderObstacle(scene, obs) {
    // create the obstacle sprite
    obstacle = scene.physics.add.sprite(sceneW + 50 + obs.xOffset, obs.startingHeight, obs.name);

    obstacle.parameters = obs;

    obstacle.displayWidth = obs.width;
    obstacle.scaleY = obstacle.scaleX; // extra line to scale the image proportional

    // Set gravity and horizontal velocity to scroll the obstacle from right to left
    obstacle.body.setGravityY(obs.gravity);  // gravity applied to each obstacle
    let velX = -platformSpeed * platToVelFactor * obs.speedFactor
    obstacle.body.setVelocityX(velX);

    // Place the obstacles in front of the background
    obstacle.setDepth(obs.depth); // Depth of 1 puts it in front of the background (which is at 0)

    let randomDelay = Phaser.Math.Between(0, 1000);

    // Create a tween to make the object wobble up and down, or left and right
    switch (obs.tween) {
        case 'updown':
            scene.tweens.add({
                targets: obstacle,
                y: obstacle.y - 40,        // Move the object up by 40 pixels
                ease: 'Sine.easeInOut',    // Smooth easing for up-and-down motion
                duration: 500,             // Duration of the wobble (500 ms up, 500 ms down)
                yoyo: true,                // Yoyo makes the object go back down after reaching the top
                repeat: -1                 // Repeat indefinitely for continuous wobble
            });
            break;
        case 'trot':
            scene.tweens.add({
                targets: obstacle,
                y: obstacle.y - 20,
                ease: 'Cubic.easeInOut',
                duration: 200,
                yoyo: true,
                repeat: -1
            });
            break;
        case 'leftright':
            scene.tweens.add({
                targets: obstacle.body.velocity,
                x: velX - 80,
                ease: 'Sine.easeInOut',
                duration: 200,
                yoyo: true,
                repeat: -1
            });
            break;
        case 'leftrightX':
            scene.tweens.add({
                targets: obstacle,
                x: obstacle.x - 15,
                ease: 'Sine.easeInOut',
                duration: 150,
                yoyo: true,
                repeat: -1,
                delay: randomDelay
            });
            break;
        case 'flyby':
            scene.tweens.add({
                targets: obstacle,
                x: obstacle.x - sceneW - 100,
                ease: 'Sine.easeIn',
                duration: obs.speedFactor,
                delay: randomDelay,
                loop: -1
            });
            break;
        case 'wobble':
            obstacle.setOrigin(0.5, 1);
            scene.tweens.add({
                targets: obstacle,
                angle: 10,
                ease: 'Back.easeInOut',
                duration: 200,
                yoyo: true,
                repeat: -1
            });
            break;
        case 'divebomb':
            scene.tweens.add({
                targets: obstacle,
                y: obstacle.y + sceneH,
                ease: 'Back.easeIn',
                duration: (1 / platformSpeed * platToVelFactor * 45),
            });
            break;
        case 'leapup':
            scene.tweens.add({
                targets: obstacle,
                y: 0,
                ease: 'Back.easeOut',
                duration: (1 / platformSpeed * platToVelFactor * 45),
            });
            break;
        case 'winnerHeart':
            scene.tweens.add({
                targets: obstacle,
                y: obstacle.y - 200,
                ease: 'Sine.easeInOut',
                duration: 1000,
                yoyo: true,
                repeat: -1
            });
            break;
        case 'appear':
            obstacle.setAlpha(0);
            scene.tweens.add({
                targets: obstacle,
                alpha: 1,
                ease: 'Linear',
                duration: 2000,
            });
            break;
        case 'party':
            oldScaleX = obstacle.scaleX;
            oldScaleY = obstacle.scaleY;
            obstacle.scaleX = 0;
            obstacle.scaleY = 0;
            scene.tweens.chain({
                targets: obstacle,
                tweens: [
                    {
                        delay: randomDelay,
                        scaleX: oldScaleX,
                        scaleY: oldScaleY,
                        duration: 250,
                        ease: 'Power1'

                    },
                    {
                        y: obstacle.y - 20,
                        ease: 'Power1',
                        duration: 150,
                        loop: 3,
                        yoyo: true
                    },
                    {
                        x: obstacle.x - 50,
                        ease: 'Cubic.easeInOut',
                        duration: 500,
                    },
                    {
                        scaleX: -oldScaleX,
                        ease: 'Sine.easeInOut',
                        duration: 300,
                    },
                    {
                        y: obstacle.y - 20,
                        ease: 'Power1',
                        duration: 150,
                        loop: 3,
                        yoyo: true
                    },
                    {
                        x: obstacle.x + 50,
                        ease: 'Cubic.easeInOut',
                        duration: 500,
                    },
                    {
                        scaleX: -oldScaleX,
                        ease: 'Sine.easeInOut',
                        duration: 300,
                    },
                ],
                loop: -1
            });

            break;

    }

    // add collision handler
    scene.physics.add.collider(obstacle, groundCollider);
    scene.physics.add.collider(player, obstacle, hitObstacle, null, scene);

    obstacle.passed = false;  // Add a custom flag to track if the obstacle has been passed
    obstacle.score = obs.score * platformSpeed;
    obstaclesArray.push(obstacle);
}


function hitObstacle(player, obstacle) {
    gameState = 'after';
    ground.tilePositionX = 0; // Stop ground movement
    this.physics.pause();  // End game on collision

    if (obstacle.parameters.name === 'cyanHeart') {
        playerCollisionWinner(this, player);
        scoreText.setText('Congratulations! You made it to Hedgeheart!');
    } else {
        playerCollisionByee(this, player);
        scoreText.setText('Journey Over! Only ' + convertSecondsIntoText(score) + ' to go to Hedgeheart');
    }

    playAgainButton = addButton(this, 'Play again?');

    // On button click, restart the game
    playAgainButton.on('pointerdown', () => {
        startGame(this, playAgainButton);
    });
}

function addButton(scene, buttonText) {
    // Create a "Play Again" button
    buttonW = 200;
    buttonH = 80;
    buttonX = sceneW / 2;
    buttonY = sceneH / 2;
    // Draw the "Play Again" button background with rounded edges and raised look
    buttonBackground = scene.add.graphics();
    buttonBackground.fillStyle(0x222222, 0.3); // Grey color for the background
    buttonBackground.fillRoundedRect(0 - (buttonW / 2), 0 - (buttonH / 2), buttonW, buttonH, 40); // Rounded rectangle (x, y, width, height, radius)
    buttonBackground.lineStyle(6, 0x888888, 0.5); // Add a border
    buttonBackground.strokeRoundedRect(0 - (buttonW / 2), 0 - (buttonH / 2), buttonW, buttonH, 40); // Border with rounded edges

    // Create the text on top of the rounded button
    button = scene.add.text(0, 0, buttonText, {
        fontSize: '26px',
        fontFamily: fontFamily,
        fill: '#ffffff' // White text color
    }).setOrigin(0.5); // Center the text on the button

    // Create a container to group the text and graphics together
    buttonGroup = scene.add.container(buttonX, buttonY, [buttonBackground, button]);
    buttonGroup.setSize(buttonW, buttonH); // Set the size of the container for interaction
    buttonGroup.alpha = 0;
    button.setDepth(101);

    // Tween for fading in the button background
    scene.tweens.add({
        targets: buttonGroup,
        alpha: 1,  // Fade to fully visible (alpha = 1)
        duration: 500,
        ease: 'Linear'
    });

    // Make the button interactive
    buttonGroup.setInteractive();

    buttonGroup.on('pointerover', () => {
        scene.input.setDefaultCursor('pointer');  // Change the cursor to pointer
    });

    buttonGroup.on('pointerout', () => {
        scene.input.setDefaultCursor('default');  // Reset the cursor back to default
    });

    return buttonGroup;
}

function playerCollisionByee(scene, player) {
    player.setTint(0xff0000);  // Flash red to show game over
    player.body.setVelocity(0); // Stop player movement
    scene.obstacleHitSound.play();

    // Tween for bouncing player out of scene
    scene.tweens.add({
        targets: player,
        y: player.y + sceneH,
        duration: 1000,
        ease: 'Back.easeIn',
        // yoyo: true,
        repeat: 0
    });
}

function playerCollisionWinner(scene, player) {
    player.setTint(0xfff700);  // Flash golden to show game over
    player.body.setVelocity(0); // Stop player movement
    scene.winnerSound.play();

    // bring all the obstacles back in for a dance party
    renderObstacle(scene, { name: 'cactusS', speedFactor: 0, startingHeight: 500, gravity: gravity, width: 80, xOffset: -sceneW + 40, tween: 'appear', depth: 4, score: 0 });
    renderObstacle(scene, { name: 'cactusL', speedFactor: 0, startingHeight: 460, gravity: gravity, width: 140, xOffset: -sceneW + 90, tween: 'appear', depth: 3, score: 0 });
    renderObstacle(scene, { name: 'cactusS', speedFactor: 0, startingHeight: 500, gravity: gravity, width: 80, xOffset: -sceneW + 140, tween: 'appear', depth: 4, score: 0 });
    renderObstacle(scene, { name: 'cactusS', speedFactor: 0, startingHeight: 500, gravity: gravity, width: 80, xOffset: -sceneW + 580, tween: 'appear', depth: 4, score: 0 });
    renderObstacle(scene, { name: 'cactusL', speedFactor: 0, startingHeight: 460, gravity: gravity, width: 140, xOffset: -sceneW + 630, tween: 'appear', depth: 3, score: 0 });
    renderObstacle(scene, { name: 'cactusS', speedFactor: 0, startingHeight: 500, gravity: gravity, width: 80, xOffset: -sceneW + 680, tween: 'appear', depth: 4, score: 0 });
    renderObstacle(scene, { name: 'flamingo', speedFactor: 0, startingHeight: 540, gravity: gravity, width: 80, xOffset: -sceneW + 550, tween: 'wobble', depth: 5, score: 0 });
    renderObstacle(scene, { name: 'flamingo', speedFactor: 0, startingHeight: 540, gravity: gravity, width: 80, xOffset: -sceneW + 490, tween: 'wobble', depth: 6, score: 0 });
    renderObstacle(scene, { name: 'flamingo', speedFactor: 0, startingHeight: 540, gravity: gravity, width: 80, xOffset: -sceneW + 430, tween: 'wobble', depth: 7, score: 0 });
    renderObstacle(scene, { name: 'crab', speedFactor: 0, startingHeight: 500, gravity: gravity, width: 80, xOffset: -sceneW + 150, tween: 'leftrightX', depth: 5, score: 0 });
    renderObstacle(scene, { name: 'crab', speedFactor: 0, startingHeight: 500, gravity: gravity, width: 80, xOffset: -sceneW + 210, tween: 'leftrightX', depth: 6, score: 0 });
    renderObstacle(scene, { name: 'crab', speedFactor: 0, startingHeight: 500, gravity: gravity, width: 80, xOffset: -sceneW + 270, tween: 'leftrightX', depth: 7, score: 0 });
    renderObstacle(scene, { name: 'bird', speedFactor: 2000, startingHeight: 150, gravity: gravity, width: 80, xOffset: 0, tween: 'flyby', depth: 8, score: 0 });
    renderObstacle(scene, { name: 'bird', speedFactor: 2000, startingHeight: 200, gravity: gravity, width: 80, xOffset: 0, tween: 'flyby', depth: 9, score: 0 });
    renderObstacle(scene, { name: 'bird', speedFactor: 2000, startingHeight: 250, gravity: gravity, width: 80, xOffset: 0, tween: 'flyby', depth: 10, score: 0 });
    renderObstacle(scene, { name: 'eagle', speedFactor: 1500, startingHeight: 150, gravity: gravity, width: 80, xOffset: 0, tween: 'flyby', depth: 8, score: 0 });
    renderObstacle(scene, { name: 'eagle', speedFactor: 1500, startingHeight: 200, gravity: gravity, width: 80, xOffset: 0, tween: 'flyby', depth: 9, score: 0 });
    renderObstacle(scene, { name: 'eagle', speedFactor: 1500, startingHeight: 250, gravity: gravity, width: 80, xOffset: 0, tween: 'flyby', depth: 10, score: 0 });
    renderObstacle(scene, { name: 'lizard', speedFactor: 0, startingHeight: 540, gravity: gravity, width: 50, xOffset: -80, tween: 'wobble', depth: 15, score: 0 });
    renderObstacle(scene, { name: 'zebra', speedFactor: 0, startingHeight: 470, gravity: gravity, width: 140, xOffset: -sceneW + sceneW / 2 - 40, tween: 'party', depth: 6, score: 0 });

    // Tween for spinning player
    scene.tweens.add({
        targets: player,
        y: player.y - 100,
        duration: 500,
        ease: 'Sine.easeIn',
        yoyo: true,
        repeat: -1
    });
}

function addCloudsWithRandomDelay() {
    if (gameState != 'after') {

        // add obstacles with a random delay between x and y milliseconds
        randomDelay = Phaser.Math.Between(300, 2000);

        this.time.addEvent({
            delay: randomDelay,
            callback: littleFluffyClouds,
            callbackScope: this,
            loop: false // use the addOstacle to call this again later
        });
    }
}

function littleFluffyClouds() {

    // create the obstacle sprite
    randomHeight = Phaser.Math.Between(100, 350);
    cloud = this.physics.add.sprite(sceneW + 100, randomHeight, 'cloud'); // set to appear off screen to the right

    //randomSize = Phaser.Math.Between(100, 250); // bigger clouds at the back
    randomSize = 300 - (randomHeight * 0.5); // bigger clouds at the back

    cloud.displayWidth = randomSize; // change this up and down to create cluster
    cloud.scaleY = cloud.scaleX; // extra line to scale the image proportional

    // Set transparency (alpha)
    randomTrans = Phaser.Math.Between(5, 8);
    cloud.setAlpha(randomTrans / 10);  // Set 50-80% transparency

    // Apply a blur effect using a blur shader (if supported by the browser)
    //const fx = cloud.preFX.addBlur(quality=0, strength=0);

    // Place the sprite behind others using depth
    cloud.setDepth(0); // Depth of 0 puts it behind everything else

    // Set gravity and horizontal velocity to scroll the cloud from right to left
    cloud.body.setGravityY(-gravity);  // gravity applied to each cloud

    randomSpeed = 1 / (randomSize / 250); // the larger the cloud the slower it goes
    cloud.body.setVelocityX(-platformSpeed * platToVelFactor * randomSpeed);  // flex this up and down to get paralax

    addCloudsWithRandomDelay.call(this);
}

function showPassedCelebration(scene, obstacle) {
    //obstacle.setTint(0x00ff00);  // Flash to show passed
    // Create text over the obstacle
    if (obstacle.score > 0) {
        let scoreFlash = scene.add.text(obstacle.x, obstacle.y - 50, '- ' + convertSecondsIntoText(obstacle.score), {
            fontSize: '32px',
            fill: '#ff0',
            fontFamily: fontFamily,
            fontStyle: 'bold'
        }).setOrigin(0.5).setDepth(50);

        // Tween to move the score flash upwards and fade it out
        scene.tweens.add({
            targets: scoreFlash,
            y: obstacle.y - 100, // Move it up
            alpha: 0,            // Fade it out
            duration: 1000,      // 1 second duration
            ease: 'Linear',
            onComplete: function () {
                scoreFlash.destroy(); // Destroy the text once the animation is complete
            }
        });
        scene.obstaclePassSound.play();
    }
}

function setupControls() {
    // Setup combined controls (keyboard and touch)
    // Keyboard controls (for desktop)
    cursors = this.input.keyboard.createCursorKeys();

    // Left and right arrow keys
    cursors.left.on('down', () => inputState.left = true);
    cursors.left.on('up', () => inputState.left = false);

    cursors.right.on('down', () => inputState.right = true);
    cursors.right.on('up', () => inputState.right = false);

    // up cursor for jumping
    cursors.up.on('down', () => inputState.jump = true);
    cursors.up.on('up', () => inputState.jump = false);
    // space for jumping
    cursors.space.on('down', () => inputState.jump = true);
    cursors.space.on('up', () => inputState.jump = false);

    // down cursor bar for jumping
    cursors.down.on('down', () => inputState.down = true);
    cursors.down.on('up', () => inputState.down = false);

    // Setup touch controls for mobile
    const leftButton = document.getElementById('left-btn');
    const rightButton = document.getElementById('right-btn');
    const jumpButton = document.getElementById('jump-btn');

    // Left button touch events
    leftButton.addEventListener('touchstart', () => inputState.left = true);
    leftButton.addEventListener('touchend', () => inputState.left = false);

    // Right button touch events
    rightButton.addEventListener('touchstart', () => inputState.right = true);
    rightButton.addEventListener('touchend', () => inputState.right = false);

    // Jump button touch event
    jumpButton.addEventListener('touchstart', () => inputState.jump = true);
    jumpButton.addEventListener('touchend', () => inputState.jump = false);

}

function applyWebSocketAction(action, scene, button) {
    // Apply the action received from the server
    inputState.left = false;
    inputState.right = false;
    inputState.jump = false;
    inputState.down = false;
    switch (action) {
        case 0: // left
            inputState.left = true;
            break;
        case 1: // right
            inputState.right = true;
            break;
        case 2: // jump
            inputState.jump = true;
            break;
        case 3: // idle
            break;
        case "Start":
            if (gameState != 'during') startGame(scene, button);
            break;
        case "Reset":
            startGame(scene, button);
            break;
    }

}

function update() {

    // Scroll the ground to the left by adjusting its tile position
    if (gameState !== 'after') ground.tilePositionX += platformSpeed;  // Adjust this value to control the speed of scrolling

    if (gameState === 'during') player.body.setVelocityX(-platformSpeed * platToVelFactor); // move left

    if (inputState.left) // if the left arrow key is down
    {
        player.body.setVelocityX(-platformSpeed * platToVelFactor * 4.5); // move left
        player.flipX = false; // flip the sprite to the left
        playerLRSoundWithCoolDown(this);
    }
    else if (inputState.right) // if the right arrow key is down
    {
        player.body.setVelocityX(platformSpeed * platToVelFactor * 3); // move right
        player.flipX = true; // use the original sprite looking to the right
        playerLRSoundWithCoolDown(this);
    }
    if (inputState.jump && player.body.onFloor()) {
        player.body.setVelocityY(-1200); // jump up
        this.playerJumpSound.play();
    }
    else if (inputState.down && !player.body.onFloor()) {
        player.body.setVelocityY(400); // pull jump down
    }

    // Check if player passes each obstacle
    obstaclesArray.forEach((obstacle) => {
        if (!obstacle.passed && player.x > obstacle.x) {
            // Increment score if the player passes the obstacle
            score -= obstacle.score;
            showPassedCelebration(this, obstacle);
            obstacle.passed = true;  // Mark the obstacle as passed to avoid counting it again
        }

        if (obstacle.x > 0) {
            // update speed of obstacles if platform speed changes
            let velX = -platformSpeed * platToVelFactor * obstacle.parameters.speedFactor;
            if (velX != obstacle.body.velocity.x) {
                obstacle.body.setVelocityX(velX);
            }
        }
    });

    // set the text to show the current score 
    // convert score in seconds to days,hours, mins and seconds
    text = 'Time to Hedgeheart: ' + convertSecondsIntoText(score);
    if (config.physics.arcade.debug) text += ' GameClock: ' + gameClock + ' Platform Speed: ' + platformSpeed;
    scoreText.setText(text);

    if (score < 10 && winner == false && gameState === 'during') {
        // 10 second to the end add heart obstacle
        winner = true;
        renderObstacle(this, { name: 'cyanHeart', speedFactor: 3, startingHeight: 350, gravity: 0, width: 400, xOffset: 0, tween: 'winnerHeart', depth: 1, score: 0 });
    }

    // Websockets response. Capture the current game state, send it to the server
    if (AIControl && socket.readyState === WebSocket.OPEN && WSSendNow === true) {
        socket.send(JSON.stringify(gameStatusResponse()));
        WSSendNow = false;
    }

    if (gameState === 'after') {
        return;  // Stop running the update function if the game is over
    }
}

function gameStatusResponse() {

    const gridSizeX = 10;
    const gridSizeY = 10;
    const cellSizeX = Math.floor(sceneW / gridSizeX);
    const cellSizeY = Math.floor(sceneH / gridSizeY);
    const map = Array(gridSizeX).fill().map(() => Array(gridSizeY).fill(0));

    // Place player on the grid
    const playerPosX = Math.floor(player.x / cellSizeX);
    const playerPosY = Math.floor(player.y / cellSizeY);
    if (playerPosX >= 0 && playerPosX < gridSizeX && playerPosY >= 0 && playerPosY < gridSizeY) {
        map[playerPosX][playerPosY] = 1;
    }
    // Map obstacles relative to player
    obstaclesArray.forEach((obstacle) => {
        if (!obstacle.passed) {
            const obstaclePosX = Math.floor(obstacle.x / cellSizeX);
            const obstaclePosY = Math.floor(obstacle.y / cellSizeY);

            const obsSpeedFactor = Math.floor(obstacle.parameters.speedFactor) + 1

            // Check if the obstacle falls within the grid
            if (obstaclePosX >= 0 && obstaclePosX < gridSizeX && obstaclePosY >= 0 && obstaclePosY < gridSizeY) {
                map[obstaclePosX][obstaclePosY] = obsSpeedFactor; // Mark this cell as containing an obstacle
            }
        }
    });

    if (startingReward == score) {
        reward = 0;
    } else {
        reward = startingReward - score;
        startingReward = score;
    };

    if (gameState === 'after') { doneFlag = true } else { doneFlag = false };

    return {
        state: map,
        reward: reward,
        done: doneFlag
    };
}

function playerLRSoundWithCoolDown(scene) {
    let currentTime = scene.time.now;
    // Check if the cooldown has passed before playing the sound
    if (currentTime - lastplayerLRSoundTime > playerLRSoundCooldown) {
        scene.playerLRSound.play();
        lastplayerLRSoundTime = currentTime; // Update the last sound time
    }
}

function convertSecondsIntoText(totalSeconds) {
    const days = Math.floor(totalSeconds / (24 * 60 * 60));
    const hours = Math.floor((totalSeconds % (24 * 60 * 60)) / (60 * 60));
    const minutes = Math.floor((totalSeconds % (60 * 60)) / 60);
    const seconds = Math.round(totalSeconds % 60);

    return [
        days > 0 ? `${days} ${days === 1 ? 'day' : 'days'}` : '',
        hours > 0 ? `${hours} ${hours === 1 ? 'hour' : 'hours'}` : '',
        minutes > 0 ? `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}` : '',
        seconds > 0 ? `${seconds} ${seconds === 1 ? 'second' : 'seconds'}` : ''
    ].filter(Boolean).join(' ') || '0 seconds';
}
