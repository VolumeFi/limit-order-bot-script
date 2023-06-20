import os
import uvloop
import asyncio
import json
import time
from dotenv import load_dotenv
from paloma_sdk.core.coins import Coins
from paloma_sdk.core.wasm import MsgExecuteContract
from paloma_sdk.client.lcd import AsyncLCDClient
from paloma_sdk.key.mnemonic import MnemonicKey
from paloma_sdk.client.lcd.api.tx import CreateTxOptions


async def set_paloma(config: dict):
    paloma_lcd = os.environ['PALOMA_LCD']
    paloma_chain_id = os.environ['PALOMA_CHAIN_ID']
    paloma: AsyncLCDClient = AsyncLCDClient(
        url=paloma_lcd, chain_id=paloma_chain_id)
    paloma.gas_prices = "0.01ugrain"
    mnemonic: str = os.environ['PALOMA_KEY']
    acct: MnemonicKey = MnemonicKey(mnemonic=mnemonic)
    wallet = paloma.wallet(acct)

    tx = await wallet.create_and_sign_tx(CreateTxOptions(msgs=[
        MsgExecuteContract(wallet.key.acc_address, config['CW'], {
                "set_paloma": {}
            }, Coins())
    ]))
    result = await paloma.tx.broadcast_sync(tx)
    time.sleep(6)
    print(result)


async def main():
    load_dotenv()
    f = open('networks.json')
    data = json.load(f)
    for config in data:
        await set_paloma(config)


if __name__ == "__main__":
    uvloop.install()
    asyncio.run(main())
