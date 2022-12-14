'use strict';

const gpu = new GPU();
const cpu = new GPU({ mode: 'cpu' });

// Kernel: Transforms a linear array of image data into (x,y) data in 4 channels,
// resulting in a 3-D array.
const createTransformLinearToXYZ = createStandardKernel(function(imageData, isCameraFlipped) {
    var x, y, z;

    // Image's color channel is every 4 elements (R, G, B, A). Omit every 4th element.
    z = this.thread.z;

    // Input image data is y-inverted so we need to read from bottom up.
    y = 4 * this.constants.width * (this.constants.height - this.thread.y - 1);

    // Optionally flip the camera if the argument is true.
    if (isCameraFlipped === 0) x = 4 * this.thread.x;
    else x = 4 * (this.constants.width - this.thread.x);

    // Input image data is an integer between 0 to 255, but should return float between 0 to 1.
    return imageData[x + y + z] / 256;
});

// Embossed filter
const createEmbossedFilter = createStandardKernel(function(A) {
    if (
        this.thread.y > 0 &&
        this.thread.y < this.constants.height - 1 &&
        this.thread.x < this.constants.width - 1 &&
        this.thread.x > 0 &&
        this.thread.z < this.constants.channels
    ) {
        var c =
            A[this.thread.z][this.thread.y - 1][this.thread.x - 1] * -1 +
            A[this.thread.z][this.thread.y][this.thread.x - 1] * -2 +
            A[this.thread.z][this.thread.y + 1][this.thread.x - 1] * -1 +
            A[this.thread.z][this.thread.y - 1][this.thread.x + 1] +
            A[this.thread.z][this.thread.y][this.thread.x + 1] * 2 +
            A[this.thread.z][this.thread.y + 1][this.thread.x + 1];
        var d =
            A[this.thread.z][this.thread.y - 1][this.thread.x - 1] * -1 +
            A[this.thread.z][this.thread.y - 1][this.thread.x] * -2 +
            A[this.thread.z][this.thread.y - 1][this.thread.x + 1] * -1 +
            A[this.thread.z][this.thread.y + 1][this.thread.x - 1] +
            A[this.thread.z][this.thread.y + 1][this.thread.x] * 2 +
            A[this.thread.z][this.thread.y + 1][this.thread.x + 1];
        return c + d + 0.5;
    } else {
        return A[this.thread.z][this.thread.y][this.thread.x];
    }
});

// Gaussian filter 
const createGaussianFilter = createStandardKernel(function(A, sigma, k00, k01, k02, k11, k12, k22) {
    if (
        this.thread.y > 1 &&
        this.thread.y < this.constants.height - 2 &&
        this.thread.x < this.constants.width - 2 &&
        this.thread.x > 1 &&
        this.thread.z < this.constants.channels
    ) {
        // Calculate the sum of all terms for a 5x5 kernel.
        var gaussianSum = k00 + (k01 + k02 + k11 + k22) * 4 + k12 * 8;

        // Calculate the result by convolving with the 5x5 kernel.
        var g =
            k00 * A[this.thread.z][this.thread.y][this.thread.x] +
            k01 *
                (A[this.thread.z][this.thread.y - 1][this.thread.x] +
                    A[this.thread.z][this.thread.y][this.thread.x - 1] +
                    A[this.thread.z][this.thread.y][this.thread.x + 1] +
                    A[this.thread.z][this.thread.y + 1][this.thread.x]) +
            k02 *
                (A[this.thread.z][this.thread.y - 2][this.thread.x] +
                    A[this.thread.z][this.thread.y][this.thread.x - 2] +
                    A[this.thread.z][this.thread.y][this.thread.x + 2] +
                    A[this.thread.z][this.thread.y + 2][this.thread.x]) +
            k11 *
                (A[this.thread.z][this.thread.y - 1][this.thread.x - 1] +
                    A[this.thread.z][this.thread.y - 1][this.thread.x + 1] +
                    A[this.thread.z][this.thread.y + 1][this.thread.x - 1] +
                    A[this.thread.z][this.thread.y + 1][this.thread.x + 1]) +
            k12 *
                (A[this.thread.z][this.thread.y - 2][this.thread.x - 1] +
                    A[this.thread.z][this.thread.y - 2][this.thread.x + 1] +
                    A[this.thread.z][this.thread.y - 1][this.thread.x - 2] +
                    A[this.thread.z][this.thread.y - 1][this.thread.x + 2] +
                    A[this.thread.z][this.thread.y + 1][this.thread.x - 2] +
                    A[this.thread.z][this.thread.y + 1][this.thread.x + 2] +
                    A[this.thread.z][this.thread.y + 2][this.thread.x - 1] +
                    A[this.thread.z][this.thread.y + 2][this.thread.x + 1]) +
            k22 *
                (A[this.thread.z][this.thread.y - 2][this.thread.x - 2] +
                    A[this.thread.z][this.thread.y - 2][this.thread.x + 2] +
                    A[this.thread.z][this.thread.y + 2][this.thread.x - 2] +
                    A[this.thread.z][this.thread.y + 2][this.thread.x + 2]);

        // Renormalize the result so that the sum of all terms in the kernel is 1.
        return g / gaussianSum;
    } else {
        return A[this.thread.z][this.thread.y][this.thread.x];
    }
});


// Light tunnel 
const createLightTunnelFilter = createStandardKernel(
    function(A, radius) {
        // Calculate if pixel falls within circle.
        // Don't use floor() because it's unnecessary (division by 2).
        var midpointX = this.constants.width / 2 - 0.5 * (this.constants.width % 2);
        var midpointY = this.constants.height / 2 - 0.5 * (this.constants.height % 2);

        // Calculate Pythagorean distance (squared to avoid costly sqrt).
        var radiusSquared = radius * radius;
        var distSquared =
            (this.thread.x - midpointX) * (this.thread.x - midpointX) + (this.thread.y - midpointY) * (this.thread.y - midpointY);

        // Return actual pixel if it falls within the circle.
        if (distSquared <= radiusSquared) {
            return A[this.thread.z][this.thread.y][this.thread.x];
        } else {
            // Otherwise, get the pixel at the border of the circle, using trigonometry.
            var opp = midpointY - this.thread.y;
            var adj = midpointX - this.thread.x;
            var angle = atan2(opp, adj);

            var x = midpointX - Math.floor(radius * Math.cos(angle));
            var y = midpointY - Math.floor(radius * Math.sin(angle));

            // Return the new pixel.
            return A[this.thread.z][y][x];
        }
    },
    { atan2 }
);

// Kernel: Renders a 3-D array into a 2-D graphic array via a Canvas.
const createRenderGraphical = mode =>
    getKernelCreator(mode)
        .createKernel(function(A) {
            this.color(A[0][this.thread.y][this.thread.x], A[1][this.thread.y][this.thread.x], A[2][this.thread.y][this.thread.x], 1);
        })
        .setGraphical(true)
        .setOutput([width, height]);
