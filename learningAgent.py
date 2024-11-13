import os
import asyncio
import json
import random
import numpy as np
import matplotlib.pyplot as plt
import websockets
from concurrent.futures import ProcessPoolExecutor

# turn off logging
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '3'

import tensorflow as tf
from tensorflow.keras import models, layers, optimizers

tf.get_logger().setLevel('ERROR')
tf.autograph.set_verbosity(0) # "0" means no logging
tf.keras.utils.disable_interactive_logging()

print("Number of GPUs Available: ", len(tf.config.experimental.list_physical_devices('GPU')))

# WebSocket server configuration
SERVER_HOST = 'localhost'
SERVER_PORT = 8081

TOTAL_EPISODES = 10000
LEARNING_INTERVAL = 100
MAX_STEPS = 500
MODEL_FILE_NAME = 'j2hh_learning_model.keras'

# Global episode counter that persists across connections
episode_counter = 0
learning_counter = 0

# Executor for running learning in a separate process
executor = ProcessPoolExecutor()

history = []

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
        model.add(layers.Input(shape=self.state_size))
        model.add(layers.Flatten())
        model.add(layers.Dense(24, activation='relu'))
        model.add(layers.Dense(24, activation='relu'))
        model.add(layers.Dense(self.action_size, activation='linear'))
        model.compile(loss='mse', optimizer=optimizers.Adam(learning_rate=self.learning_rate))
        return model
    
    def save_model(self, path='saved_model'):
        os.makedirs(path, exist_ok=True)
        self.model.save(os.path.join(path, MODEL_FILE_NAME))
        print("Model saved to disk")
        
    def load_model(self, path='saved_model'):
        model_path = os.path.join(path, MODEL_FILE_NAME)
        if os.path.exists(model_path):
            self.model = models.load_model(model_path)
            print("Model loaded from disk.")
        else:
            print("No saved model found. Starting with a new model.")

    def select_action(self, state):
        if np.random.rand() <= self.epsilon:
            return random.choice([0,1,2,3])  # Actions
        act_values = self.model.predict(np.array([state]))
        return np.argmax(act_values[0])

    def remember(self, state, action, reward, next_state, done):
        self.memory.append((state, action, reward, next_state, done))
        if len(self.memory) > LEARNING_INTERVAL:
            self.memory.pop(0)
            
    def memorySize(self):
        return len(self.memory)

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
            
# Asynchronous non-blocking learn function using ProcessPoolExecutor
async def non_blocking_learn(agent):
    loop = asyncio.get_running_loop()
    await loop.run_in_executor(executor, agent.learn)

# WebSocket handler function that incorporates episodes
async def handle_episode(websocket, agent, episodes=1000, max_steps=500):
    global episode_counter, learning_counter
    
    while episode_counter < TOTAL_EPISODES:  # Stop after reaching TOTAL_EPISODES
        
        if learning_counter >= LEARNING_INTERVAL:
            await non_blocking_learn(agent)
            learning_counter = 0
            agent.save_model()

        learning_counter += 1 # learn and save model before the gameplay loop
        
        # Increment the episode counter for each new episode
        episode_counter += 1
        print(f"Episode {episode_counter}/{TOTAL_EPISODES} started")

        # Send a "reset" message to start a new episode without reconnecting
        await websocket.send(json.dumps({"action": "Reset"}))
        
        # Receive initial state from the game
        message = await websocket.recv()
        data = json.loads(message)
        state = data['state']
    
        total_reward = 0
        step_count = 0
        done = False
    
        while not done and step_count < MAX_STEPS:
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
        
        print(f"Episode {episode_counter} ended with total reward: {total_reward}")
        # store stats for evaluation
        # history.append([total_reward, agent.epsilon])

# WebSocket server setup
async def main():
    state_size = (10,10)  # Adjust based on game state representation
    action_size = 4   # Number of actions (e.g., [0: "Left", 1: "Right", 2: "Jump", 3: "Idle"])
    agent = DQNAgent(state_size=state_size, action_size=action_size)
    agent.load_model()  # Load saved model if available
    
    async with websockets.serve(lambda ws, path: handle_episode(ws, agent, TOTAL_EPISODES, MAX_STEPS), SERVER_HOST, SERVER_PORT):
        print(f"WebSocket server started on ws://{SERVER_HOST}:{SERVER_PORT}")
        await asyncio.Future()  # Run forever

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as e:
        print("An error occurred in the main function", e)   
    finally:
        executor.shutdown(wait=True)  # Cleanly shutdown the executor when the server stops