import {
  time,
  loadFixture,
} from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { expect } from "chai";
import hre from "hardhat";
import { getAddress, getContract, WalletClient, PublicClient } from "viem";
import { bscTestnet } from "viem/chains";

const days90RewardMultiplier = 100n;
const days180RewardMultiplier = 400n;

describe("TokenStaking", function () {
  // We define a fixture to reuse the same setup in every test.
  // We use loadFixture to run this setup once, snapshot that state,
  // and reset Hardhat Network to that snapshot in every test.
  async function deployFixture() {
    // Contracts are deployed using the first signer/account by default
    const [owner, otherAccount] = await hre.viem.getWalletClients({
      chain: bscTestnet,
    });

    const tokenContract = await hre.viem.deployContract("MyToken", [
      owner.account.address,
      owner.account.address,
    ]);

    const tokenStakingContract = await hre.viem.deployContract("TokenStaking", [
      tokenContract.address,
      days90RewardMultiplier,
      days180RewardMultiplier,
    ]);

    const publicClient = await hre.viem.getPublicClient({ chain: bscTestnet });

    return {
      owner,
      otherAccount,
      publicClient,
      tokenContract,
      tokenStakingContract,
    };
  }

  describe("Deployment", function () {
    it("Should set the right multipliers", async function () {
      const { tokenStakingContract } = await loadFixture(deployFixture);

      expect(await tokenStakingContract.read.days90RewardMultiplier()).to.equal(
        days90RewardMultiplier
      );
      expect(
        await tokenStakingContract.read.days180RewardMultiplier()
      ).to.equal(days180RewardMultiplier);
    });

    it("Should set the right owner", async function () {
      const { tokenStakingContract, owner } = await loadFixture(deployFixture);

      expect(await tokenStakingContract.read.owner()).to.equal(
        getAddress(owner.account.address)
      );
    });

    it("Should set the right token address", async function () {
      const { tokenStakingContract, tokenContract } = await loadFixture(
        deployFixture
      );

      expect(await tokenStakingContract.read.stakingToken()).to.equal(
        getAddress(tokenContract.address)
      );
    });
  });

  describe("Actions", function () {
    it("Should stake and save record in contract", async function () {
      const {
        publicClient,
        otherAccount,
        tokenStakingContract,
        tokenContract,
      } = await loadFixture(deployFixture);

      const contract = getContract({
        address: tokenStakingContract.address,
        abi: tokenStakingContract.abi,
        client: otherAccount,
      });

      const tokenContractWc = getContract({
        address: tokenContract.address,
        abi: tokenContract.abi,
        client: otherAccount,
      });

      const addresses = await otherAccount.getAddresses();

      // approve spending of token to staking contract
      const approveHash = await tokenContractWc.write.approve(
        [tokenStakingContract.address, 10000000n],
        { account: addresses[0] }
      );

      await publicClient.waitForTransactionReceipt({
        hash: approveHash,
      });

      await tokenContractWc.read.allowance([addresses[0], contract.address]);

      const {
        request: { args, ...options },
      } = await contract.simulate.createStake(
        [10000n, BigInt(90 * 24 * 60 * 60)],
        { account: addresses[0] }
      );

      const hash = await contract.write.createStake(
        args as [bigint, bigint],
        options
      );

      await publicClient.waitForTransactionReceipt({ hash });

      const stakesCount = await contract.read.getAccountStakeCount([
        addresses[0],
      ]);

      expect(stakesCount).to.equals(1n);

      const stake = await contract.read.getStake([addresses[0], 0n]);

      expect(stake.amount).to.equal(10000n);
      expect(stake.duration).to.equal(7776000n);
      expect(stake.multiplier).to.equal(days90RewardMultiplier);
    });

    it("Should fail if user claims before stake period is over", async function () {
      const {
        publicClient,
        otherAccount,
        tokenStakingContract,
        tokenContract,
      } = await loadFixture(deployFixture);

      const contract = getContract({
        address: tokenStakingContract.address,
        abi: tokenStakingContract.abi,
        client: otherAccount,
      });

      const tokenContractWc = getContract({
        address: tokenContract.address,
        abi: tokenContract.abi,
        client: otherAccount,
      });

      const addresses = await otherAccount.getAddresses();

      // approve spending of token to staking contract
      const approveHash = await tokenContractWc.write.approve(
        [tokenStakingContract.address, 10000000n],
        { account: addresses[0] }
      );

      await publicClient.waitForTransactionReceipt({
        hash: approveHash,
      });

      const {
        request: { args, ...options },
      } = await contract.simulate.createStake(
        [10000n, BigInt(90 * 24 * 60 * 60)],
        { account: addresses[0] }
      );

      const hash = await contract.write.createStake(
        args as [bigint, bigint],
        options
      );

      await publicClient.waitForTransactionReceipt({ hash });

      await expect(
        contract.write.getReward([0n], { account: addresses[0] })
      ).to.be.rejectedWith("StakingPeriodIsNotReached()");
    });

    it("Should fail if user tries to access nonexisting stake index", async function () {
      const {
        publicClient,
        otherAccount,
        tokenStakingContract,
        tokenContract,
      } = await loadFixture(deployFixture);

      const contract = getContract({
        address: tokenStakingContract.address,
        abi: tokenStakingContract.abi,
        client: otherAccount,
      });

      const tokenContractWc = getContract({
        address: tokenContract.address,
        abi: tokenContract.abi,
        client: otherAccount,
      });

      const addresses = await otherAccount.getAddresses();

      // approve spending of token to staking contract
      const approveHash = await tokenContractWc.write.approve(
        [tokenStakingContract.address, 10000000n],
        { account: addresses[0] }
      );

      await publicClient.waitForTransactionReceipt({
        hash: approveHash,
      });

      await expect(
        contract.read.getStake([addresses[0], 1n])
      ).to.be.rejectedWith("No staking info for sender at given index");
    });

    it("Should error out when contract doesnt have enough balance to pay the user off", async function () {
      const {
        publicClient,
        otherAccount,
        tokenStakingContract,
        tokenContract,
      } = await loadFixture(deployFixture);

      const contract = getContract({
        address: tokenStakingContract.address,
        abi: tokenStakingContract.abi,
        client: otherAccount,
      });

      const tokenContractWc = getContract({
        address: tokenContract.address,
        abi: tokenContract.abi,
        client: otherAccount,
      });

      const addresses = await otherAccount.getAddresses();

      const initialTokenBalance = await tokenContractWc.read.balanceOf([
        addresses[0],
      ]);

      // approve spending of token to staking contract
      const approveHash = await tokenContractWc.write.approve(
        [tokenStakingContract.address, 10000000n],
        { account: addresses[0] }
      );

      await publicClient.waitForTransactionReceipt({
        hash: approveHash,
      });

      const {
        request: { args, ...options },
      } = await contract.simulate.createStake(
        [10000n, BigInt(90 * 24 * 60 * 60)],
        { account: addresses[0] }
      );

      const hash = await contract.write.createStake(
        args as [bigint, bigint],
        options
      );

      await publicClient.waitForTransactionReceipt({ hash });

      await time.increase(90 * 24 * 60 * 61);

      expect(contract.write.getReward([0n])).to.be.rejectedWith(
        "InsufficientRewardTokens()"
      );
    });

    it("Should get rewards when stake period is over", async function () {
      const {
        publicClient,
        otherAccount,
        tokenStakingContract,
        tokenContract,
        owner,
      } = await loadFixture(deployFixture);

      const contract = getContract({
        address: tokenStakingContract.address,
        abi: tokenStakingContract.abi,
        client: otherAccount,
      });

      const tokenContractWc = getContract({
        address: tokenContract.address,
        abi: tokenContract.abi,
        client: otherAccount,
      });
      const ownerTokenContractWc = getContract({
        address: tokenContract.address,
        abi: tokenContract.abi,
        client: owner,
      });

      await ownerTokenContractWc.write.transfer([
        tokenStakingContract.address,
        2000000n,
      ]);

      const addresses = await otherAccount.getAddresses();

      const initialTokenBalance = await tokenContractWc.read.balanceOf([
        addresses[0],
      ]);

      // approve spending of token to staking contract
      const approveHash = await tokenContractWc.write.approve(
        [tokenStakingContract.address, 10000000n],
        { account: addresses[0] }
      );

      await publicClient.waitForTransactionReceipt({
        hash: approveHash,
      });

      const {
        request: { args, ...options },
      } = await contract.simulate.createStake(
        [10000n, BigInt(90 * 24 * 60 * 60)],
        { account: addresses[0] }
      );

      const hash = await contract.write.createStake(
        args as [bigint, bigint],
        options
      );

      await publicClient.waitForTransactionReceipt({ hash });

      await time.increase(90 * 24 * 60 * 61);

      const rewardHash = await contract.write.getReward([0n], {
        account: addresses[0],
      });
      await publicClient.waitForTransactionReceipt({ hash: rewardHash });

      const tokenBalance = await tokenContractWc.read.balanceOf([addresses[0]]);

      expect(tokenBalance - initialTokenBalance).to.equal(
        10000n + (1n / 10n) * 10000n
      );
    });

    it("Should be able to unstake before period is over", async function () {
      const {
        publicClient,
        otherAccount,
        tokenStakingContract,
        tokenContract,
        owner,
      } = await loadFixture(deployFixture);

      const contract = getContract({
        address: tokenStakingContract.address,
        abi: tokenStakingContract.abi,
        client: otherAccount,
      });

      const tokenContractWc = getContract({
        address: tokenContract.address,
        abi: tokenContract.abi,
        client: otherAccount,
      });
      const ownerTokenContractWc = getContract({
        address: tokenContract.address,
        abi: tokenContract.abi,
        client: owner,
      });

      await ownerTokenContractWc.write.transfer([
        tokenStakingContract.address,
        2000000n,
      ]);

      const addresses = await otherAccount.getAddresses();

      const initialTokenBalance = await tokenContractWc.read.balanceOf([
        addresses[0],
      ]);

      // approve spending of token to staking contract
      const approveHash = await tokenContractWc.write.approve(
        [tokenStakingContract.address, 10000000n],
        { account: addresses[0] }
      );

      await publicClient.waitForTransactionReceipt({
        hash: approveHash,
      });

      const {
        request: { args, ...options },
      } = await contract.simulate.createStake(
        [10000n, BigInt(90 * 24 * 60 * 60)],
        { account: addresses[0] }
      );

      const hash = await contract.write.createStake(
        args as [bigint, bigint],
        options
      );

      await publicClient.waitForTransactionReceipt({ hash });

      await time.increase(10);

      const removeHash = await contract.write.removeStake([0n], {
        account: addresses[0],
      });
      await publicClient.waitForTransactionReceipt({ hash: removeHash });

      const tokenBalance = await tokenContractWc.read.balanceOf([addresses[0]]);

      expect(tokenBalance - initialTokenBalance).to.equal(0n);
    });
  });
});
