// Journey to the Hedgeheart
// a platform jumper inspired by the google chrome "no internet" game
// but with graphics and gameplay influenced by my love for Cyan
// based on https://gamedevacademy.org/how-to-make-a-mario-style-platformer-with-phaser-3/


/* to do:
- game width overlapping text on mid screen sizes
- more obstacles (platforms?)
- collect apples
- high score
- sound off button
- first two obstacles don't kill if player hasn't moved
- more interesting background
- walk along start button
? better collision detection
? trees in background
X max and min spacing for each ostacle type
X when platform speed changes, update speed of all visible objects
X obstacle clusters (CACTUS CLUSTERS!)
X better winner sequence
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

let dateOfMeetingInSeconds = new Date("2024-10-30T22:50:00");

let platformSpeed = 1;
let platToVelFactor = 60;
let groundHeight = 565;
let gravity = 2000;
let gameSpeedUpInterval = 30; //seconds

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
let text;
let score = Math.round((dateOfMeetingInSeconds - Date.now()) / 1000);
let gameClock = 0;
let scoreText;
let buttonGroup;

let playerLRSoundCooldown = 250; // Cooldown time in milliseconds
let lastplayerLRSoundTime = 0; // Timestamp of the last time the sound played

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
    groundCollider.create(sceneW / 2, groundHeight - 25, 'tiles', 2).setDisplaySize(sceneW * 1.2, 0).refreshBody();
    this.physics.add.collider(player, groundCollider);

    score = Math.round((dateOfMeetingInSeconds - Date.now()) / 1000);

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

    this.obstacleHitSound = this.sound.add('obstacleHit');
    this.obstaclePassSound = this.sound.add('obstaclePass');
    this.playerJumpSound = this.sound.add('playerJump');
    this.playerLRSound = this.sound.add('playerLR', { volume: 0.2 });
    this.winnerSound = this.sound.add('winner');
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
        platformSpeed += 0.5;
        this.obstaclePassSound.setRate(this.obstaclePassSound.rate + 0.1);
    }
}

function addObstacleWithRandomDelay() {

    // add obstacles with a random delay related to the platfrom speed
    // (higher platform speed, more frequent obstacles)
    // randomDelay = Phaser.Math.Between(1 / platformSpeed * 500, 1 / platformSpeed * 5000);
    randomDelay = Phaser.Math.Between(1 / platformSpeed * 4000, 1 / platformSpeed * 8000);
    this.time.addEvent({
        delay: randomDelay,
        callback: addObstacle,
        callbackScope: this,
        loop: false // use the addOstacle to call this again later
    });
}

function addObstacle() {
    if (gameState === 'during') {
        let second = 3600;

        // Obstacle array: 0. name, 1. speed factor, 2. starting height, 
        // 3. gravity, 4. width, 5. x-offset, 6. wobble, 7. depth, 8. score (seconds)
        let obstacles = [
            ['cactusS', 1, 450, gravity, 80, 0, false, 5, 3600],
            ['flamingo', 1.5, 450, gravity, 80, 0, 'wobble', 10, 3600],
            ['crab', 0.5, 450, gravity, 80, 0, 'leftright', 9, 3600],
            ['cactusL', 1, 460, gravity, 140, 0, false, 4, 10800],
            ['bird', 2, 250, -gravity, 80, 0, 'updown', 8, 7200],
            ['cactusCluster', 1, 450, gravity, 80, 0, false, 5, 18000],
            ['eagle', 4, 150, -gravity, 100, 0, 'divebomb', 11, 1000]
        ];

        // Randomly select an obstacle - change this to add more obstacles over time
        let numberOfObsToChooseFrom = Math.min(obstacles.length, Math.round(platformSpeed) - 1);
        let obCh = Phaser.Math.Between(0, numberOfObsToChooseFrom - 1);
        let chosenObstacle = obstacles[obCh];

        if (chosenObstacle[0] === 'cactusCluster') {
            renderObstacle(this, ['cactusL', 1, 460, gravity, 140, 0, false, 4, 10800]);
            renderObstacle(this, ['cactusS', 1, 450, gravity, 80, -60, false, 5, 3600]);
            renderObstacle(this, ['cactusS', 1, 450, gravity, 80, 60, false, 5, 3600]);
        } else {
            renderObstacle(this, chosenObstacle);
        }
    }
    addObstacleWithRandomDelay.call(this);
}

function renderObstacle(scene, obs) {
    // create the obstacle sprite
    obstacle = scene.physics.add.sprite(sceneW + 50 + obs[5], obs[2], obs[0]);

    obstacle.parameters = obs;

    obstacle.displayWidth = obs[4];
    obstacle.scaleY = obstacle.scaleX; // extra line to scale the image proportional

    // Set gravity and horizontal velocity to scroll the obstacle from right to left
    obstacle.body.setGravityY(obs[3]);  // gravity applied to each obstacle
    let velX = -platformSpeed * platToVelFactor * obs[1]
    obstacle.body.setVelocityX(velX);

    // Place the obstacles in front of the background
    obstacle.setDepth(obs[7]); // Depth of 1 puts it in front of the background (which is at 0)

    // Create a tween to make the object wobble up and down, or left and right
    switch (obs[6]) {
        case 'updown':
            scene.tweens.add({
                targets: obstacle,
                y: obstacle.y - 40,        // Move the object up by 50 pixels
                ease: 'Sine.easeInOut',    // Smooth easing for up-and-down motion
                duration: 500,             // Duration of the wobble (500 ms up, 500 ms down)
                yoyo: true,                // Yoyo makes the object go back down after reaching the top
                repeat: -1                 // Repeat indefinitely for continuous wobble
            });
            break;
        case 'leftright':
            scene.tweens.add({
                targets: obstacle.body.velocity,
                x: velX - 80,        // Move the object up by 50 pixels
                ease: 'Sine.easeInOut',    // Smooth easing for up-and-down motion
                duration: 200,             // Duration of the wobble (500 ms up, 500 ms down)
                yoyo: true,                // Yoyo makes the object go back down after reaching the top
                repeat: -1                 // Repeat indefinitely for continuous wobble
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
    }

    // add collision handler
    scene.physics.add.collider(groundCollider, obstacle);
    scene.physics.add.collider(player, obstacle, hitObstacle, null, scene);

    obstacle.passed = false;  // Add a custom flag to track if the obstacle has been passed

    obstacle.score = obs[8] * platformSpeed;

    obstaclesArray.push(obstacle);
}

function hitObstacle(player, obstacle) {
    gameState = 'after';
    this.physics.pause();  // End game on collision
    playerCollisionByee(this, player);
    ground.tilePositionX = 0; // Stop ground movement
    // stop tweening
    scoreText.setText('Journey Over! Only ' + convertSecondsIntoText(score) + ' to go to Hedgeheart');

    playAgainButton = addButton(this, 'Play again?');

    // On button click, restart the game
    playAgainButton.on('pointerdown', () => {
        startGame(this);
    });
}

function addButton(scene, buttonText) {
    // Create a "Play Again" button
    buttonW = 200;
    buttonH = 80;
    buttonX = sceneW / 2 - buttonW / 2;
    buttonY = sceneH / 2 - buttonH / 2;
    // Draw the "Play Again" button background with rounded edges and raised look
    buttonBackground = scene.add.graphics();
    buttonBackground.fillStyle(0x222222, 0.3); // Grey color for the background
    buttonBackground.fillRoundedRect(0, 0, buttonW, buttonH, 20); // Rounded rectangle (x, y, width, height, radius)
    buttonBackground.lineStyle(2, 0x888888, 0.3); // Add a border
    buttonBackground.strokeRoundedRect(0, 0, buttonW, buttonH, 20); // Border with rounded edges

    // Create the text on top of the rounded button
    button = scene.add.text(buttonW / 2, buttonH / 2, buttonText, {
        fontSize: '28px',
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
        duration: 500,  // 1-second fade duration
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

    // scene.physics.add.collider(buttonGroup, player);

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

    scoreText.setText('Congratulations! You made it to Hedgeheart!');

    // Tween for spinning player
    scene.tweens.add({
        targets: player,
        y: player.y - 100,
        duration: 200,
        ease: 'Sine.easeIn',
        yoyo: true,
        repeat: -1
    });
}

function addCloudsWithRandomDelay() {

    // add obstacles with a random delay between x and y milliseconds
    randomDelay = Phaser.Math.Between(300, 2000);

    this.time.addEvent({
        delay: randomDelay,
        callback: littleFluffyClouds,
        callbackScope: this,
        loop: false // use the addOstacle to call this again later
    });

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


function update() {

    if (gameState === 'after') {
        return;  // Stop running the update function if the game is over
    }

    // Scroll the ground to the left by adjusting its tile position
    ground.tilePositionX += platformSpeed;  // Adjust this value to control the speed of scrolling

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
            let velX = -platformSpeed * platToVelFactor * obstacle.parameters[1]
            if ( velX != obstacle.body.velocity.x )
            {
             obstacle.body.setVelocityX(velX)
            }
        }
    });

    // set the text to show the current score 
    // convert score in seconds to days,hours, mins and seconds
    text = 'Time to Hedgeheart: ' + convertSecondsIntoText(score);
    if (config.physics.arcade.debug) text += ' GameClock: ' + gameClock + ' Platform Speed: ' + platformSpeed;
    scoreText.setText(text);

    if (score < 10 && winner == false) {
        // 10 second to the end add heart obstacle
        winner = true;
        addWinner.call(this);
    }

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
    const seconds = totalSeconds % 60;

    return [
        days > 0 ? `${days} ${days === 1 ? 'day' : 'days'}` : '',
        hours > 0 ? `${hours} ${hours === 1 ? 'hour' : 'hours'}` : '',
        minutes > 0 ? `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}` : '',
        seconds > 0 ? `${seconds} ${seconds === 1 ? 'second' : 'seconds'}` : ''
    ].filter(Boolean).join(' ') || '0 seconds';
}

function hitWinner() {
    gameState = 'after';
    this.physics.pause();  // End game on collision
    playerCollisionWinner(this, player);

    playAgainButton = addButton(this, 'Play again?');

    // On button click, restart the game
    playAgainButton.on('pointerdown', () => {
        startGame(this);
    });
}

function addWinner() {

    // create the obstacle sprite    
    obstacle = this.physics.add.sprite(sceneW + 50, 350, 'cyanHeart'); // set to appear off screen to the right

    obstacle.displayWidth = 600;
    obstacle.scaleY = obstacle.scaleX; // extra line to scale the image proportional

    // Place the obstacles in front of the background
    obstacle.setDepth(30); // Depth of 1 puts it in front of the background (which is at 0)


    // Set gravity and horizontal velocity to scroll the obstacle from right to left
    obstacle.body.setGravityY(gravity);  // gravity applied to each obstacle
    obstacle.body.setVelocityX(-platformSpeed * platToVelFactor * 3);
    obstacle.body.setBounce(0.2);

    // Create a tween to make the object wobble up and down, or left and right
    this.tweens.add({
        targets: obstacle,
        y: obstacle.y - 200,        // Move the object up by 50 pixels
        ease: 'Sine.easeInOut',    // Smooth easing for up-and-down motion
        duration: 1000,             // Duration of the wobble (500 ms up, 500 ms down)
        yoyo: true,                // Yoyo makes the object go back down after reaching the top
        repeat: -1                 // Repeat indefinitely for continuous wobble
    });

    // add collision handler
    this.physics.add.collider(groundCollider, obstacle);
    this.physics.add.collider(player, obstacle, hitWinner, null, this);
};
