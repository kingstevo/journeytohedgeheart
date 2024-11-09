import asyncio
import json
import random
import numpy as np
import websockets
import tensorflow as tf
from tensorflow.keras import models, layers, optimizers

print("NumPy version:", np.__version__)
print("TensorFlow version:", tf.__version__)

# Game environment interface
class GameEnvironment:
    def __init__(self, uri):
        self.uri = uri
        self.websocket = None

    async def connect(self):
        self.websocket = await websockets.connect(self.uri)

    async def reset(self):
        await self.websocket.send(json.dumps({"action": "Start"}))
        state = await self._receive_state()
        return state

    async def step(self, action):
        await self.websocket.send(json.dumps({"action": action}))
        response = await self._receive_state()
        state = response['state']
        reward = response['reward']
        done = response['done']
        return state, reward, done

    async def _receive_state(self):
        response = await self.websocket.recv()
        return json.loads(response)
    
    async def close(self):
        await self.websocket.close()

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
        model.add(layers.Dense(24, input_dim=self.state_size, activation='relu'))
        model.add(layers.Dense(24, activation='relu'))
        model.add(layers.Dense(self.action_size, activation='linear'))
        model.compile(loss='mse', optimizer=optimizers.Adam(lr=self.learning_rate))
        return model

    def select_action(self, state):
        if np.random.rand() <= self.epsilon:
            return random.choice(["Left", "Right", "Jump", "Idle"])
        act_values = self.model.predict(np.array([state]))
        return np.argmax(act_values[0])

    def remember(self, state, action, reward, next_state, done):
        self.memory.append((state, action, reward, next_state, done))
        if len(self.memory) > 2000:
            self.memory.pop(0)

    def learn(self, batch_size=32):
        minibatch = random.sample(self.memory, min(len(self.memory), batch_size))
        for state, action, reward, next_state, done in minibatch:
            target = reward
            if not done:
                target += self.gamma * np.amax(self.model.predict(np.array([next_state]))[0])
            target_f = self.model.predict(np.array([state]))
            target_f[0][action] = target
            self.model.fit(np.array([state]), target_f, epochs=1, verbose=0)
        
        if self.epsilon > self.epsilon_min:
            self.epsilon *= self.epsilon_decay

# Training function
async def train(agent, env, episodes=1000, max_steps=500):
    await env.connect()

    for episode in range(episodes):
        state = await env.reset()
        done = False
        total_reward = 0
        step_count = 0

        while not done and step_count < max_steps:
            action = agent.select_action(state)
            next_state, reward, done = await env.step(action)
            agent.remember(state, action, reward, next_state, done)
            agent.learn()

            state = next_state
            total_reward += reward
            step_count += 1

        print(f"Episode {episode + 1}/{episodes}, Total Reward: {total_reward}")

    await env.close()

# Main function to start training
if __name__ == "__main__":
    state_size = 100  # Adjust based on your game state representation
    action_size = 4   # Number of actions (e.g., ["Left", "Right", "Jump", "Idle"])

    env = GameEnvironment(uri="ws://localhost:8081")
    agent = DQNAgent(state_size=state_size, action_size=action_size)

    # Run the training loop
    asyncio.run(train(agent, env, episodes=1000))
