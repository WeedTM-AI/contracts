// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.22;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

// import "hardhat/console.sol";

/**
 * @title TokenStaking
 * @notice Staking contract for Token.
 */
contract TokenStaking is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public stakingToken;

    struct StakeInfo {
        uint amount;
        uint duration;
        uint multiplier;
        uint startTime;
        bool withdrawn;
    }

    mapping(address => StakeInfo[]) public stakes;
    uint public totalStake;
    uint public days90RewardMultiplier = 100; // in percentage
    uint public days180RewardMultiplier = 500; // in percentage

    mapping(address => uint) public userRewardTotalPaid;
    uint public totalRewardsPaid;

    constructor(
        address token_,
        uint days90RewardMultiplier_,
        uint days180RewardMultiplier_
    ) Ownable(msg.sender) {
        // Check that the token address is not 0x0.
        require(token_ != address(0x0));

        days90RewardMultiplier = days90RewardMultiplier_;
        days180RewardMultiplier = days180RewardMultiplier_;
        // Set the token address.
        stakingToken = IERC20(token_);
    }

    // events
    event CreateStake(address indexed caller, StakeInfo stake);
    event RemoveStake(address indexed caller, uint amount);
    event RewardPaid(address indexed user, uint reward);

    error InvalidStakingTokenAddress();
    error InvalidOwnerAddress();
    error InvalidRecipientAddress();
    error InvalidStakeIndex();
    error InsufficientStake();
    error StakingPeriodIsNotReached();
    error InsufficientRewardTokens();

    /**
     * @param duration duration value
     * @return multiplier that was muplitplied by 100 (1x=100, 5x=500 and etc)
     */
    function _getMultiplierByDuration(
        uint duration
    ) internal view returns (uint multiplier) {
        require(
            duration == 90 days || duration == 180 days,
            "Invalid duration"
        );

        if (duration == 90 days) {
            return days90RewardMultiplier;
        } else if (duration == 180 days) {
            return days180RewardMultiplier;
        }
    }

    /**
     * @notice Create a stake by depositing the staking token. The token transfer has to be approved by the user beforehand.
     * @param stake The amount of tokens to stake.
     */
    function createStake(uint stake, uint duration) public nonReentrant {
        require(
            duration == 90 days || duration == 180 days,
            "Invalid duration"
        );

        stakingToken.safeTransferFrom(msg.sender, address(this), stake);

        stakes[msg.sender].push(
            StakeInfo(
                stake,
                duration,
                _getMultiplierByDuration(duration),
                block.timestamp,
                false
            )
        );
        totalStake += stake;

        emit CreateStake(
            msg.sender,
            StakeInfo(stake, duration, 100, block.timestamp, false)
        );
    }

    function _getStakeExists(uint stakeIndex, address user) internal view {
        require(stakes[user].length > 0, "No staked funds for sender");
        require(
            stakes[user][stakeIndex].amount != 0,
            "Amount is zero at index."
        );
    }

    modifier hasStakeAtIndex(uint stakeIndex, address user) {
        require(
            stakes[user].length > 0,
            "No staking info for sender at given index"
        );
        require(
            stakes[user][stakeIndex].amount != 0,
            "Amount is zero at index."
        );

        _;
    }

    /**
     * @notice Remove a stake by withdrawing the staking token.
     * @param stakeIndex The stake index to withdraw
     */
    function removeStake(
        uint stakeIndex
    ) public nonReentrant hasStakeAtIndex(stakeIndex, msg.sender) {
        if (stakes[msg.sender][stakeIndex].withdrawn == true) {
            // selected stake index was already withdrawn
            revert InvalidStakeIndex();
        }

        totalStake -= stakes[msg.sender][stakeIndex].amount;

        stakingToken.safeTransfer(
            msg.sender,
            stakes[msg.sender][stakeIndex].amount
        );

        stakes[msg.sender][stakeIndex].withdrawn = true;

        emit RemoveStake(msg.sender, stakeIndex);
    }

    /**
     * @notice Claim the amount + reward for the user = msg.sender.
     *
     * @param stakeIndex = index of staketo claim
     */
    function getReward(
        uint stakeIndex
    ) public nonReentrant hasStakeAtIndex(stakeIndex, msg.sender) {
        if (stakes[msg.sender][stakeIndex].withdrawn == true) {
            // selected stake index was already withdrawn
            revert InvalidStakeIndex();
        }

        if (
            stakes[msg.sender][stakeIndex].startTime +
                stakes[msg.sender][stakeIndex].duration >
            block.timestamp
        ) {
            revert StakingPeriodIsNotReached();
        }

        uint reward = (stakes[msg.sender][stakeIndex].multiplier *
            stakes[msg.sender][stakeIndex].amount) / 100;

        if (reward > 0) {
            uint balanceToReturn = reward +
                stakes[msg.sender][stakeIndex].amount;

            if (balanceToReturn > stakingToken.balanceOf(address(this))) {
                revert InsufficientRewardTokens();
            }

            stakes[msg.sender][stakeIndex].withdrawn = true;
            stakingToken.safeTransfer(
                msg.sender,
                reward + stakes[msg.sender][stakeIndex].amount
            );

            emit RewardPaid(msg.sender, reward);
        }
    }

    /**
     * @notice Get the stake for a user.
     * @param user The address of the user to get the stake for.
     * @return The stake.
     */
    function getStake(
        address user,
        uint stakeIndex
    ) public view hasStakeAtIndex(stakeIndex, user) returns (StakeInfo memory) {
        return stakes[user][stakeIndex];
    }

    /**
     * @notice Get the stake for a user.
     * @param account The address of the user to get the stake for.
     * @return The stake.
     */
    function getAccountStakeCount(address account) public view returns (uint) {
        return stakes[account].length;
    }
}
