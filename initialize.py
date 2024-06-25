import os
import uvloop
import asyncio
import json
import time
from web3 import Web3
from web3.contract import Contract
from dotenv import load_dotenv
from paloma_sdk.core.coins import Coins
from paloma_sdk.core.wasm import MsgInstantiateContract
from paloma_sdk.client.lcd import AsyncLCDClient
from paloma_sdk.key.mnemonic import MnemonicKey
from paloma_sdk.client.lcd.api.tx import CreateTxOptions


async def limit_order_bot_init(config: dict):
    pancakeswap_lob_vyper = config['VYPER']
    pancakeswap_lob_abi = json.loads(config['ABI'])
    payload = ""

    paloma_lcd = os.environ['PALOMA_LCD']
    paloma_chain_id = os.environ['PALOMA_CHAIN_ID']
    paloma: AsyncLCDClient = AsyncLCDClient(
        url=paloma_lcd, chain_id=paloma_chain_id)
    paloma.gas_prices = "0.01ugrain"
    mnemonic: str = os.environ['PALOMA_KEY']
    acct: MnemonicKey = MnemonicKey(mnemonic=mnemonic)
    wallet = paloma.wallet(acct)

    # Job create
    job_id = config['JOB_ID']
    chain_type = config['CHAIN_TYPE']
    chain_reference_id = config['CHAIN_REFERENCE_ID']
    creator = wallet.key.acc_address
    signers = [wallet.key.acc_address]
    result = await paloma.job_scheduler.create_job(
        wallet, job_id, pancakeswap_lob_vyper, pancakeswap_lob_abi, payload,
        chain_type, chain_reference_id, creator, signers)
    print(result)
    time.sleep(6)

    # Instantiate
    initialize_msg = {
        "retry_delay": 30,
        "job_id": job_id,
        "creator": creator,
        "signers": signers,
    }
    code_id = os.environ['LOB_CW_CODE_ID']
    funds = Coins()
    tx = await wallet.create_and_sign_tx(
        CreateTxOptions(
            msgs=[
                MsgInstantiateContract(
                    wallet.key.acc_address,
                    wallet.key.acc_address,
                    int(code_id),
                    job_id,
                    initialize_msg,
                    funds
                )
            ]
        )
    )
    result = await paloma.tx.broadcast_sync(tx)
    time.sleep(6)
    print(result)


async def main():
    load_dotenv()
    f = open('networks.json')
    data = json.load(f)
    for config in data:
        await limit_order_bot_init(config)


if __name__ == "__main__":
    uvloop.install()
    asyncio.run(main())
