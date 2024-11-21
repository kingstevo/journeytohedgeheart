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

MAX_STEPS = 500
MODEL_FILE_NAME = 'j2hh_learning_model.keras'

# DQN Agent
class DQNAgent:
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
            

# WebSocket handler function that incorporates episodes
async def handle_episode(websocket, agent):
    
    # Send a "reset" message to start a new episode without reconnecting
    await websocket.send(json.dumps({"action": "Reset"}))
        
    # Receive initial state from the game
    message = await websocket.recv()
    data = json.loads(message)
    state = data['state']

    total_reward = 0
    step_count = 0
    done = False
    
    # set agent epsilon to 0 to see how the model does without any randomness
    agent.epsilon = 0

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
        
        # Update state and cumulative reward
        state = next_state
        total_reward += reward
        step_count += 1
        
    print(f"Episode ended with total reward: {total_reward}")

# WebSocket server setup
async def main():
    agent = DQNAgent()
    agent.load_model()  # Load saved model if available
    
    async with websockets.serve(lambda ws, path: handle_episode(ws, agent), SERVER_HOST, SERVER_PORT):
        print(f"WebSocket server started on ws://{SERVER_HOST}:{SERVER_PORT}")
        await asyncio.Future()  # Run forever

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as e:
        print("An error occurred in the main function", e)   
    finally:
        # Cleanly shutdown the executor when the server stops
        print("Finished")
