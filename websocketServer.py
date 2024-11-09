import asyncio
import websockets
import json

url = "localhost"
port = 8081

async def server(websocket,path):
    try:
        # Send a command and receive the game state from the server       
        for action in ["Start", "Jump", "Left", "Right","Idle", "Jump", "Left", "Right",
                       "Idle","Jump", "Left", "Right","Idle", "Jump", "Left", "Right", "Idle",
                       "Idle","Jump", "Left", "Right","Idle", "Jump", "Left", "Right", "Idle",
                       "Start", "Jump"
                       ]:
            jsonToSend = { "action": action}
            await websocket.send(json.dumps(jsonToSend))
            print(f"Sent action: {action}")

            response = await websocket.recv()
            game_state = json.loads(response)
            print("Received game state:", game_state)
               
            print("Score:", game_state["reward"])

            if game_state["done"]:
            #player is dead - next episode
                score = -1
                break

            await asyncio.sleep(1)
        
    #except:
       # print("Connection closed")
        
    finally:
        print("Client disconnected")
        
# Define a main async function and run it
async def main():
    async with websockets.serve(server, url, port):
        print("Server started on",url,port)
        await asyncio.Future()  # Run forever

# Run the main function
asyncio.run(main())