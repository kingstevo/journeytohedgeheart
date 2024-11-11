import os
import asyncio
import json
import random
import numpy as np
import websockets

# turn off logging
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '3'

import tensorflow as tf
from tensorflow.keras import models, layers, optimizers

tf.get_logger().setLevel('ERROR')
tf.autograph.set_verbosity(0) # "0" means no logging
tf.keras.utils.disable_interactive_logging()


# WebSocket server configuration
SERVER_HOST = 'localhost'
SERVER_PORT = 8081

episodes=1000
max_steps=500

# Global episode counter that persists across connections
episode_counter = 0

# DQN Agent
class DQNAgent:
    def __init__(self, state_size, action_size):
        self.state_size = state_size
        self.action_size = action_size
        self.memory = []
        self.gamma = 0.95         # Discount factor
        self.epsilon = 1.0        # Exploration rate
        self.epsilon_min = 0.01   # Minimum exploration rate
        self.epsilon_decay = 0.995
        self.learning_rate = 0.001
        self.model = self._build_model()

    def _build_model(self):
        model = models.Sequential()
        model.add(layers.Flatten(input_shape=self.state_size))
        model.add(layers.Dense(24, activation='relu'))
        model.add(layers.Dense(24, activation='relu'))
        model.add(layers.Dense(self.action_size, activation='linear'))
        model.compile(loss='mse', optimizer=optimizers.Adam(learning_rate=self.learning_rate))
        return model

    def select_action(self, state):
        if np.random.rand() <= self.epsilon:
            return random.choice([0,1,2,3])  # Actions
        act_values = self.model.predict(np.array([state]))
        return np.argmax(act_values[0])

    def remember(self, state, action, reward, next_state, done):
        self.memory.append((state, action, reward, next_state, done))
        if len(self.memory) > 2000:
            self.memory.pop(0)

    def learn(self, batch_size=32):
        if len(self.memory) < batch_size:
            return
        
        minibatch = random.sample(self.memory, batch_size)
        for state, action, reward, next_state, done in minibatch:
            target = reward
            if not done:
                target += self.gamma * np.amax(self.model.predict(np.array([next_state]))[0])
            target_f = self.model.predict(np.array([state]))
            target_f[0][action] = target
            self.model.fit(np.array([state]), target_f, epochs=1, verbose=0)
        
        if self.epsilon > self.epsilon_min:
            self.epsilon *= self.epsilon_decay

# WebSocket handler function that incorporates episodes
async def handle_episode(websocket, agent, episodes=1000, max_steps=500):
    global episode_counter  # Use the global counter that persists across connections
    
    while episode_counter < episodes:  # Stop after reaching TOTAL_EPISODES
        # Increment the episode counter for each new episode
        episode_counter += 1
        print(f"Episode {episode_counter}/{episodes} started")

        # Send a "reset" message to start a new episode without reconnecting
        await websocket.send(json.dumps({"action": "Reset"}))
        
        # Receive initial state from the game
        message = await websocket.recv()
        data = json.loads(message)
        state = data['state']
    
        total_reward = 0
        step_count = 0
        done = False
    
        while not done and step_count < max_steps:
            # Agent selects an action
            action = int(agent.select_action(state))
        
            # Send action to the game
            await websocket.send(json.dumps({"action": action}))
        
            # Add a short delay to prevent rapid action sending
            await asyncio.sleep(0.5)  # Adjust delay as needed
        
            # Receive new state, reward, and done flag from the game
            message = await websocket.recv()
            data = json.loads(message)
            next_state = data['state']
            reward = data['reward']
            done = data['done']
        
            # Remember experience and learn
            agent.remember(state, action, reward, next_state, done)
        
            # Update state and cumulative reward
            state = next_state
            total_reward += reward
            step_count += 1

        agent.learn()
        print(f"Episode {episode_counter} ended with total reward: {total_reward}")

# WebSocket server setup
async def main():
    state_size = (10,10)  # Adjust based on game state representation
    action_size = 4   # Number of actions (e.g., [0: "Left", 1: "Right", 2: "Jump", 3: "Idle"])
    agent = DQNAgent(state_size=state_size, action_size=action_size)
    
    async with websockets.serve(lambda ws, path: handle_episode(ws, agent, episodes, max_steps), SERVER_HOST, SERVER_PORT):
        print(f"WebSocket server started on ws://{SERVER_HOST}:{SERVER_PORT}")
        await asyncio.Future()  # Run forever

if __name__ == "__main__":
    asyncio.run(main())