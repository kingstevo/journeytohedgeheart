// Initialize Phaser game
var config = {
    type: Phaser.AUTO,
    width: 1000,
    height: 800,
    backgroundColor: '#87CEEB', // Light blue sky color
    physics: {
        default: 'arcade',
        arcade: {
            gravity: { y: 1000 },  // Gravity pulls the player down
            debug: false
        }
    },
    scene: {
        key: 'main',
        preload,
        create,
        update
    }
};

const game = new Phaser.Game(config);

let todayInSeconds = Date.now();
let dateOfMeetingInSeconds = new Date("2024-10-28");

countdownScore = Math.round((dateOfMeetingInSeconds - todayInSeconds) / 1000);

// let map;
let player;
let cursors;
let obstacles;
// let groundLayer, coinLayer;
let ground, groundCollider;
let text;
let score = countdownScore;
let scoreText;

function preload() {
    // map made with Tiled in JSON format
    //this.load.tilemapTiledJSON('map', 'assets/map.json');
    // tiles in spritesheet 
    this.load.spritesheet('tiles', 'assets/tiles.png', { frameWidth: 70, frameHeight: 70 });
    // simple coin image
    //this.load.image('coin', 'assets/coinGold.png');
    // player animations
    //this.load.atlas('player', 'assets/player.png', 'assets/player.json');
    this.load.image('hedgehog', 'assets/hedgehog.png');
    this.load.image('flamingo', 'assets/flamingo.png');
    this.load.image('crab', 'assets/crab.png');
}
function create() {
    // // load the map 
    // map = this.make.tilemap({ key: 'map' });

    // // tiles for the ground layer
    // var groundTiles = map.addTilesetImage('tiles');
    // // create the ground layer
    // groundLayer = map.createLayer('World', groundTiles, 0, 0);
    // // the player will collide with this layer
    // groundLayer.setCollisionByExclusion([-1]);

    // set the boundaries of our game world
    this.physics.world.bounds.width = config.width;
    this.physics.world.bounds.height = config.height;


    // Add a scrolling ground using tileSprite
    ground = this.add.tileSprite(400, 568, 1000, 70, 'tiles', 0); // Adjust the width, height, and y position as necessary
    //ground.setCollisionByExclusion([-1]);

    // create the player sprite    
    player = this.physics.add.sprite(200, 200, 'hedgehog');
    player.displayWidth = 100;
    player.scaleY = player.scaleX; // extra line to scale the image proportional

    //const playerEmoji = this.add.text(0, -30, '🦔', { fontSize: '64px' });
    //player = this.add.container(0, 0, [ playerEmoji ]);
    //player.setSize(30, 40);
    //this.physics.world.enable(player);

    player.body.setBounce(0.2); // our player will bounce from items
    player.body.setCollideWorldBounds(true); // don't go out of the map
    player.body.setVelocityX(100);

    // Create a static ground collider for the player to stand on
    const groundCollider = this.physics.add.staticGroup();
    groundCollider.create(config.width / 2, 568, 'groundTiles', 0).setDisplaySize(config.width, 30).refreshBody();
    this.physics.add.collider(player, groundCollider);

    cursors = this.input.keyboard.createCursorKeys();

    // // set bounds so the camera won't go outside the game world
    // this.cameras.main.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    // // make the camera move right 
    // this.cameras.main.startFollow(player);

    // set background color, so the sky is not black    
    //this.cameras.main.setBackgroundColor('#ccccff'); 


    scoreText = this.add.text(20, 20, 'Score: ' + score, {
        fontSize: '20px',
        fill: '#ffffff'
    });
    scoreText.setScrollFactor(0);

    // add obstacles
    //obstacles = this.physics.add.group();

    // Generate an obstacle every 2 seconds
    this.time.addEvent({
        delay: 2000,
        callback: addObstacle,
        callbackScope: this,
        loop: true
    });

}
function addObstacle() {

    // create the player sprite    
    obstacle = this.physics.add.sprite(1000, 400, 'flamingo'); // set to appear off screen to the right
    obstacle.displayWidth = 80;
    obstacle.scaleY = obstacle.scaleX; // extra line to scale the image proportional

    // Add physics to the obstacle
    //this.physics.add.existing(obstacle);

    // Set horizontal velocity to scroll the obstacle from right to left
    obstacle.body.setVelocityX(-100);


    // add collision handler
    this.physics.add.collider(groundCollider, obstacle);
    this.physics.add.collider(player, obstacle, hitObstacle, null, this);

    // Add the obstacle to the group
    //obstacles.add(obstacle);

}

function hitObstacle(player, obstacle) {
    this.physics.pause();  // End game on collision
    player.setTint(0xff0000);  // Flash red to show game over
    player.body.setVelocity(0); // Stop player movement
    scoreText.setText('Game Over! Final Score: ' + score);
}

function update() {

    // Scroll the ground to the left by adjusting its tile position
    ground.tilePositionX += 5;  // Adjust this value to control the speed of scrolling


    if (cursors.left.isDown) // if the left arrow key is down
    {
        player.body.setVelocityX(-100); // move left
        //player.anims.play('walk', true); // play walk animation
        player.flipX = false; // flip the sprite to the left
    }
    else if (cursors.right.isDown) // if the right arrow key is down
    {
        player.body.setVelocityX(200); // move right
        //player.anims.play('walk', true); // play walk animatio
        player.flipX = true; // use the original sprite looking to the right
    }
    if ((cursors.space.isDown || cursors.up.isDown) && player.body.onFloor()) {
        player.body.setVelocityY(-1000); // jump up
        //player.anims.play('idle', true);
    }

    // reduce score
    score--; // increment the score
    scoreText.setText('Score: ' + score); // set the text to show the current score
}

