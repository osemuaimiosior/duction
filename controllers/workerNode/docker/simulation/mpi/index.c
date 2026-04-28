#include <stdio.h>
#include <stdlib.h>
#include <math.h>
#include <time.h>

// Generate standard normal random variable using Box-Muller
double rand_normal() {
    double u1 = ((double) rand() + 1.0) / ((double) RAND_MAX + 1.0);
    double u2 = ((double) rand() + 1.0) / ((double) RAND_MAX + 1.0);
    return sqrt(-2.0 * log(u1)) * cos(2.0 * M_PI * u2);
}

double monte_carlo_black_scholes(
    double S0,   // Spot price
    double K,    // Strike price
    double sigma,// Volatility
    double r,    // Risk-free rate
    double T,    // Time to expiry
    int num_sim  // Number of simulations
) {
    double payoff_sum = 0.0;

    for (int i = 0; i < num_sim; i++) {
        double Z = rand_normal();

        // Simulate terminal price
        double ST = S0 * exp((r - 0.5 * sigma * sigma) * T +
                             sigma * sqrt(T) * Z);

        // Call option payoff
        double payoff = fmax(ST - K, 0.0);

        payoff_sum += payoff;
    }

    double mean_payoff = payoff_sum / num_sim;

    // Discount to present value
    double option_price = exp(-r * T) * mean_payoff;

    return option_price;
}

int main() {
    srand(time(NULL));

    double S0, K, sigma, r, T;
    int simulations;

    printf("Enter Spot Price ($): ");
    scanf("%lf", &S0);

    printf("Enter Strike Price ($): ");
    scanf("%lf", &K);

    printf("Enter Volatility (%%): ");
    scanf("%lf", &sigma);
    sigma /= 100.0;

    printf("Enter Risk-Free Rate (%%): ");
    scanf("%lf", &r);
    r /= 100.0;

    printf("Enter Time to Expiry (years): ");
    scanf("%lf", &T);

    printf("Enter Number of Simulations: ");
    scanf("%d", &simulations);

    double price = monte_carlo_black_scholes(S0, K, sigma, r, T, simulations);

    printf("\nEstimated Call Option Price: %.6f\n", price);

    return 0;
}