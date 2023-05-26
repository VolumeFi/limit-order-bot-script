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


async def limit_order_bot_init():
    node: str = os.environ['BNB_NODE']
    w3: Web3 = Web3(Web3.HTTPProvider(node))
    pancakeswap_lob_vyper = os.environ['PANCAKESWAP_LOB_VYPER']
    pancakeswap_lob_abi = json.loads(os.environ['LOB_ABI'])
    lob_sc: Contract = w3.eth.contract(
        address=pancakeswap_lob_vyper, abi=pancakeswap_lob_abi)
    payload = lob_sc.encodeABI("multiple_withdraw", [[], [], []])[2:]

    paloma_lcd = os.environ['PALOMA_LCD']
    paloma_chain_id = os.environ['PALOMA_CHAIN_ID']
    paloma: AsyncLCDClient = AsyncLCDClient(
        url=paloma_lcd, chain_id=paloma_chain_id)
    paloma.gas_prices = "0.01ugrain"
    mnemonic: str = os.environ['PALOMA_KEY']
    acct: MnemonicKey = MnemonicKey(mnemonic=mnemonic)
    wallet = paloma.wallet(acct)

    # Job create
    job_id = os.environ['PANCAKESWAP_LOB_JOB_ID']
    chain_type = os.environ['PANCAKESWAP_CHAIN_TYPE']
    chain_reference_id = os.environ['PANCAKESWAP_CHAIN_REFERENCE_ID']
    result = await paloma.job_scheduler.create_job(
        wallet, job_id, pancakeswap_lob_vyper, pancakeswap_lob_abi, payload,
        chain_type, chain_reference_id)
    print(result)
    time.sleep(6)

    # Instantiate
    initialize_msg = {
        "retry_delay": 60,
        "job_id": job_id
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
    print(result)


async def main():
    load_dotenv()
    await limit_order_bot_init()


if __name__ == "__main__":
    uvloop.install()
    asyncio.run(main())
