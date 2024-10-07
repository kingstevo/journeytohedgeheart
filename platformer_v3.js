// Lover levels - journey to the hedgeheart
// a platform jumper inspired by the google chrome "no internet" game
// but with graphics and gameplay influenced by my love for Cyan
// based on https://gamedevacademy.org/how-to-make-a-mario-style-platformer-with-phaser-3/


/* to do:
* work on mobile
X scale to fit window size
? better collision detection
? trees in background
- max and min spacing for each ostacle type
- first obstacle doesn't kill!
- more obstacles (platforms?)
X speed up platform as game proceeds
X increase scoring as game speeds up
X fix jumping movement
- add sounds
X space to start, space to play again
X better score display
- better winner sequence
X host online with domain
X create logo, favicon, name
- more interesting background
- walk along start button
X reset gameclock on new game
- high score
*/

let dateOfMeetingInSeconds = new Date("2024-10-30T15:30:00");

let platformSpeed = 1;
let platToVelFactor = 60;
let groundHeight = 565;
let gravity = 2000;

let fontFamily = 'Arial';

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


// Initialize Phaser game
var config = {
    type: Phaser.AUTO,
    width: window.innerWidth,
    height: 600,
    scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_HORIZONTALLY,
        width: '100%',
        height: '100%',
    },
    backgroundColor: '#87CEEB', // Light blue sky color
    physics: {
        default: 'arcade',
        arcade: {
            gravity: { y: gravity },  // Gravity pulls the player down
            debug: true
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
    this.load.image('cyanHeart', 'assets/cyanHeart.png');
}

function create() {

    // set the boundaries of our game world
    this.physics.world.bounds.width = config.width;
    this.physics.world.bounds.height = config.height;

    // Add a scrolling ground using tileSprite
    ground = this.add.tileSprite(config.width / 2, groundHeight, config.width, 70, 'tiles', 2);

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
    groundCollider.create(config.width / 2, groundHeight - 25, 'tiles', 2).setDisplaySize(config.width * 1.2, 0).refreshBody();
    this.physics.add.collider(player, groundCollider);

        // Combine both keyboard and touch controls
        setupControls.call(this);

    score = Math.round((dateOfMeetingInSeconds - Date.now()) / 1000);

    scoreText = this.add.text(20, config.height - 40, 'Score: ' + convertSecondsIntoText(score), {
        fontSize: '20px',
        fill: '#ffffff',
        fontFamily: 'Arial'
    });
    scoreText.setScrollFactor(0);

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
    if ((gameClock > 0) && (gameClock % 20 === 0)) {
        platformSpeed += 0.5;
    }
}

function addObstacleWithRandomDelay() {

    // add obstacles with a random delay related to the platfrom speed
    // (higher platform speed, more frequent obstacles)
    randomDelay = Phaser.Math.Between(1 / platformSpeed * 2000, 1 / platformSpeed * 10000);

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

        // Obstacle array: name, speed factor, starting height, gravity, width, wobble, depth, score (seconds)
        let obstacles = [
            ['flamingo', 1.5, 450, gravity, 80, 'wobble', 10, 3600],
            ['crab', 0.5, 450, gravity, 80, 'leftright', 9, 3600],
            ['bird', 2, 250, -gravity, 80, 'updown', 8, 7200],
            ['cactusL', 1, 460, gravity, 140, false, 4, 10800],
            ['cactusS', 1, 450, gravity, 80, false, 5, 3600],
        ];

        // Randomly select an obstacle - change this to add more obstacles over time
        let obCh = Phaser.Math.Between(0, obstacles.length - 1);

        // console.log("Random obstacle: ", obstacles[obCh])

        // create the obstacle sprite    
        obstacle = this.physics.add.sprite(config.width + 50, obstacles[obCh][2], obstacles[obCh][0]); // set to appear off screen to the right
        // obstaclesG.push(obstacle);

        obstacle.displayWidth = obstacles[obCh][4];
        obstacle.scaleY = obstacle.scaleX; // extra line to scale the image proportional

        // Place the obstacles in front of the background
        obstacle.setDepth(obstacles[obCh][6]); // Depth of 1 puts it in front of the background (which is at 0)

        // Set gravity and horizontal velocity to scroll the obstacle from right to left
        obstacle.body.setGravityY(obstacles[obCh][3]);  // gravity applied to each obstacle
        let velX = -platformSpeed * platToVelFactor * obstacles[obCh][1]
        obstacle.body.setVelocityX(velX);

        // Create a tween to make the object wobble up and down, or left and right
        if (obstacles[obCh][5] === 'updown') {
            this.tweens.add({
                targets: obstacle,
                y: obstacle.y - 40,        // Move the object up by 50 pixels
                ease: 'Sine.easeInOut',    // Smooth easing for up-and-down motion
                duration: 500,             // Duration of the wobble (500 ms up, 500 ms down)
                yoyo: true,                // Yoyo makes the object go back down after reaching the top
                repeat: -1                 // Repeat indefinitely for continuous wobble
            });
        }

        // Create a tween to make the object wobble up and down, or left and right
        if (obstacles[obCh][5] === 'leftright') {
            this.tweens.add({
                targets: obstacle.body.velocity,
                x: velX - 80,        // Move the object up by 50 pixels
                ease: 'Sine.easeInOut',    // Smooth easing for up-and-down motion
                duration: 200,             // Duration of the wobble (500 ms up, 500 ms down)
                yoyo: true,                // Yoyo makes the object go back down after reaching the top
                repeat: -1                 // Repeat indefinitely for continuous wobble
            });
        }
        // Create a tween to make the object wobble up and down, or left and right
        if (obstacles[obCh][5] === 'wobble') {
            obstacle.setOrigin(0.5, 1);
            this.tweens.add({
                targets: obstacle,
                angle: 10,        // Move the object up by 50 pixels
                ease: 'Back.easeInOut',    // Smooth easing for up-and-down motion
                duration: 200,             // Duration of the wobble (500 ms up, 500 ms down)
                yoyo: true,                // Yoyo makes the object go back down after reaching the top
                repeat: -1                 // Repeat indefinitely for continuous wobble
            });
        }

        // add collision handler
        this.physics.add.collider(groundCollider, obstacle);
        this.physics.add.collider(player, obstacle, hitObstacle, null, this);

        obstacle.passed = false;  // Add a custom flag to track if the obstacle has been passed

        obstacle.score = obstacles[obCh][7] * platformSpeed;

        obstaclesArray.push(obstacle);

    }
    addObstacleWithRandomDelay.call(this);
}

function hitObstacle(player, obstacle) {
    gameState = 'after';
    this.physics.pause();  // End game on collision
    playerCollisionByee(this, player);
    ground.tilePositionX = 0; // Stop ground movement
    // stop tweening
    scoreText.setText('Game Over! Only ' + convertSecondsIntoText(score) + ' to hedgeheart');

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
    buttonX = config.width / 2 - buttonW / 2;
    buttonY = config.height / 2 - buttonH / 2;
    // Draw the "Play Again" button background with rounded edges and raised look
    buttonBackground = scene.add.graphics();
    buttonBackground.fillStyle(0x222222, 0.3); // Grey color for the background
    buttonBackground.fillRoundedRect(0, 0, buttonW, buttonH, 20); // Rounded rectangle (x, y, width, height, radius)
    buttonBackground.lineStyle(2, 0x888888, 0.3); // Add a border
    buttonBackground.strokeRoundedRect(0, 0, buttonW, buttonH, 20); // Border with rounded edges

    // Create the text on top of the rounded button
    button = scene.add.text(buttonW / 2, buttonH / 2, buttonText, {
        fontSize: '32px',
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


    return buttonGroup;
}

function playerCollisionByee(scene, player) {
    player.setTint(0xff0000);  // Flash red to show game over
    player.body.setVelocity(0); // Stop player movement

    // Tween for bouncing player out of scene
    scene.tweens.add({
        targets: player,
        y: player.y + config.height,
        duration: 1000,
        ease: 'Back.easeIn',
        // yoyo: true,
        repeat: 0
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
    cloud = this.physics.add.sprite(config.width + 100, randomHeight, 'cloud'); // set to appear off screen to the right

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
    }
    else if (inputState.right) // if the right arrow key is down
    {
        player.body.setVelocityX(platformSpeed * platToVelFactor * 3); // move right
        player.flipX = true; // use the original sprite looking to the right
    }
    if (inputState.jump && player.body.onFloor()) {
        player.body.setVelocityY(-1200); // jump up
    }
    else if (inputState.down && !player.body.onFloor()) {
        player.body.setVelocityY(400); // pull jump down
    }
    //  // }

    // Check if player passes each obstacle
    obstaclesArray.forEach((obstacle) => {
        if (!obstacle.passed && player.x > obstacle.x) {
            // Increment score if the player passes the obstacle
            score -= obstacle.score;
            showPassedCelebration(this, obstacle);
            obstacle.passed = true;  // Mark the obstacle as passed to avoid counting it again
        }
    });

    // set the text to show the current score 
    // convert score in seconds to days,hours, mins and seconds
    text = 'Time to hedgeheart: ' + convertSecondsIntoText(score);
    if (config.physics.arcade.debug) text += ' GameClock: ' + gameClock + ' Platform Speed: ' + platformSpeed;
        scoreText.setText(text);

    if (score < 10 && winner == false) {
        // 10 second to the end add heart obstacle
        winner = true;
        addWinner.call(this);
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
    playerCollisionByee(this, player);
    ground.tilePositionX = 0; // Stop ground movement
    scoreText.setText('WINNER! Final Score: ' + convertSecondsIntoText(score));
}

function addWinner() {

    // create the obstacle sprite    
    obstacle = this.physics.add.sprite(config.width + 50, 350, 'cyanHeart'); // set to appear off screen to the right

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
